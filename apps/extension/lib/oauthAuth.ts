import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";

// Background-worker only. Never import this module from popup/content scripts.
const IS_FIREFOX = import.meta.env.BROWSER === "firefox";
const CLIENT_ID = IS_FIREFOX ? "teak-firefox" : "teak-chrome";
const TOKEN_KEY = "teakOAuthCredentials";
const OWNER_KEY = "teakOAuthOwner";
export const AUTH_STATE_KEY = "teakOAuthState";
interface Credentials {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
  userId?: string;
}
let ready: Promise<void> | undefined;
let login: Promise<void> | undefined;
let generation = 0;

export function getConvexSiteUrl() {
  const url = import.meta.env.VITE_PUBLIC_CONVEX_SITE_URL;
  if (!url) {
    throw new Error("Missing VITE_PUBLIC_CONVEX_SITE_URL");
  }
  return url;
}

export function initializeAuth() {
  ready ??= (
    IS_FIREFOX
      ? Promise.resolve()
      : chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  ).then(async () => {
    // The previous dedicated session is deliberately not exchanged. Updating
    // requires one OAuth reconnect; shared native-session infrastructure stays intact.
    await chrome.storage.local.remove([
      "teakSessionToken",
      "teakPendingNativeAuth",
    ]);
  });
  return ready;
}

// Firefox cannot restrict storage.local to trusted extension contexts. Its
// extension-origin IndexedDB is inaccessible to page content scripts and durable
// across background-page restarts. Chromium keeps its existing protected storage.
async function firefoxCredentials<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("teak-oauth", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("credentials");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction("credentials", mode);
      const request = operation(transaction.objectStore("credentials"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Could not store sign-in."));
    });
  } finally {
    database.close();
  }
}

async function readCredentials(): Promise<Credentials | null> {
  await initializeAuth();
  const record = (
    IS_FIREFOX
      ? await firefoxCredentials("readonly", (store) => store.get(TOKEN_KEY))
      : (await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY]
  ) as Partial<Credentials> | undefined;
  return record &&
    typeof record.accessToken === "string" &&
    typeof record.refreshToken === "string" &&
    Number.isFinite(record.expiresAt)
    ? (record as Credentials)
    : null;
}

async function writeCredentials(credentials: Credentials | null) {
  if (credentials) {
    if (IS_FIREFOX) {
      await firefoxCredentials("readwrite", (store) =>
        store.put(credentials, TOKEN_KEY)
      );
    }
    await chrome.storage.local.set({
      ...(IS_FIREFOX ? {} : { [TOKEN_KEY]: credentials }),
      ...(credentials.userId ? { [OWNER_KEY]: credentials.userId } : {}),
    });
  } else if (IS_FIREFOX) {
    await firefoxCredentials("readwrite", (store) => store.delete(TOKEN_KEY));
  } else {
    await chrome.storage.local.remove(TOKEN_KEY);
  }
  await chrome.storage.local.set({
    [AUTH_STATE_KEY]: {
      authenticated: Boolean(credentials),
      pending: false,
      changedAt: Date.now(),
    },
  });
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/, "");
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

async function tokenRequest(
  params: Record<string, string>
): Promise<Credentials | null> {
  const response = await fetch(`${getConvexSiteUrl()}/api/auth/mcp/token`, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  });
  if (response.status === 400 || response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Could not connect to Teak. Please try again.");
  }
  const value = await response.json();
  if (
    typeof value.access_token !== "string" ||
    typeof value.refresh_token !== "string" ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0
  ) {
    throw new Error("Invalid sign-in response.");
  }
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresAt: Date.now() + value.expires_in * 1000,
  };
}

async function revokeCredentials(credentials: Credentials) {
  const response = await fetch(`${getConvexSiteUrl()}/api/oauth/revoke`, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      token: credentials.refreshToken,
    }),
  });
  if (!response.ok) {
    throw new Error("Could not sign out. Please try again.");
  }
}

export function beginOAuthSignIn(): Promise<void> {
  login ??= (async () => {
    await initializeAuth();
    const attempt = generation;
    const state = random();
    const verifier = random();
    const challenge = base64url(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier)
        )
      )
    );
    const redirectUri = chrome.identity.getRedirectURL("oauth/callback");
    const appUrl = import.meta.env.DEV
      ? resolveTeakDevAppUrl(import.meta.env)
      : "https://app.teakvault.com";
    const url = new URL(`${appUrl}/api/auth/mcp/authorize`);
    url.search = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "profile email offline_access",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    await chrome.storage.local.set({ [AUTH_STATE_KEY]: { pending: true } });
    {
      const callback = await chrome.identity.launchWebAuthFlow({
        url: url.toString(),
        interactive: true,
      });
      if (!callback) {
        throw new Error("Sign-in was canceled.");
      }
      const result = new URL(callback);
      const code = result.searchParams.get("code");
      const expected = new URL(redirectUri);
      if (
        result.origin !== expected.origin ||
        result.pathname !== expected.pathname ||
        result.searchParams.get("state") !== state ||
        !code ||
        result.searchParams.has("error")
      ) {
        throw new Error("Sign-in could not be verified.");
      }
      const credentials = await tokenRequest({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      });
      if (!credentials) {
        throw new Error("Sign-in expired. Please try again.");
      }
      const info = await fetch(`${getConvexSiteUrl()}/api/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
        credentials: "omit",
        redirect: "error",
      });
      if (!info.ok) {
        await revokeCredentials(credentials);
        throw new Error("Could not verify your account. Please sign in again.");
      }
      const user = await info.json();
      if (typeof user.sub !== "string" || !user.sub) {
        await revokeCredentials(credentials);
        throw new Error("Invalid account response.");
      }
      credentials.userId = user.sub;
      await navigator.locks.request("teak-oauth-credentials", async () => {
        if (attempt !== generation) {
          await revokeCredentials(credentials);
          return;
        }
        await writeCredentials(credentials);
      });
    }
  })().finally(async () => {
    login = undefined;
    await chrome.storage.local.set({
      [AUTH_STATE_KEY]: { pending: false, changedAt: Date.now() },
    });
  });
  return login;
}

function credentialsForRequest() {
  return navigator.locks.request("teak-oauth-credentials", async () => {
    const credentials = await readCredentials();
    if (!credentials || credentials.expiresAt > Date.now() + 30_000) {
      return credentials;
    }
    const renewed = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    });
    if (renewed) {
      renewed.userId = credentials.userId;
    }
    await writeCredentials(renewed);
    return renewed;
  });
}

export async function oauthRequest(
  path: string,
  init: RequestInit = {},
  expectedUserId?: string
): Promise<Response | null> {
  const credentials = await credentialsForRequest();
  if (!credentials) {
    return null;
  }
  if (expectedUserId && credentials.userId !== expectedUserId) {
    throw new Error(
      "Your account changed. Sign in to the original account to finish this save."
    );
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${credentials.accessToken}`);
  const response = await fetch(`${getConvexSiteUrl()}${path}`, {
    ...init,
    headers,
    credentials: "omit",
    redirect: "error",
  });
  if (response.status === 401) {
    // A response for an older token must not clear a newly refreshed login.
    await navigator.locks.request("teak-oauth-credentials", async () => {
      if ((await readCredentials())?.accessToken === credentials.accessToken) {
        await writeCredentials(null);
      }
    });
    return null;
  }
  return response;
}

export async function getOAuthState() {
  const response = await oauthRequest("/api/oauth/userinfo");
  if (!response) {
    return { authenticated: false, pending: Boolean(login) };
  }
  if (!response.ok) {
    throw new Error("Could not load your account.");
  }
  const user = await response.json();
  if (typeof user.sub !== "string") {
    throw new Error("Invalid account response.");
  }
  return {
    authenticated: true,
    pending: Boolean(login),
    user: {
      id: user.sub,
      email: typeof user.email === "string" ? user.email : "",
      name: typeof user.name === "string" ? user.name : undefined,
    },
  };
}

export async function signOutOAuth() {
  generation += 1;
  await navigator.locks.request("teak-oauth-credentials", async () => {
    const credentials = await readCredentials();
    if (credentials) {
      await revokeCredentials(credentials);
    }
    await writeCredentials(null);
    await chrome.storage.local.remove(OWNER_KEY);
  });
}

export async function getCaptureOwner(): Promise<string | undefined> {
  await initializeAuth();
  const owner = (await chrome.storage.local.get(OWNER_KEY))[OWNER_KEY];
  return typeof owner === "string" ? owner : undefined;
}
