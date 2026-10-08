import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";
import {
  type AuthDiscovery,
  createConnectAuthorizeUrl,
  createPkceChallenge,
  disconnectConnectGrant,
  discoverAuthServer,
  fetchConnectOwnerId,
  randomBase64Url,
  requestConnectTokens,
  validateOAuthUrl,
} from "@teak/convex/sdk";
import { readResponseTextWithinLimit } from "@teak/convex/shared/bounded-response";
import { getConvexSiteUrl } from "./env";

// Background-worker only. Never import this module from popup/content scripts.
const IS_FIREFOX = import.meta.env.BROWSER === "firefox";
const SURFACE = IS_FIREFOX ? "firefox" : "chrome";
const LOCAL = Boolean(import.meta.env.DEV);
let selectedSite: string | undefined;
const site = () => {
  selectedSite ??= validateOAuthUrl(getConvexSiteUrl(), LOCAL).origin;
  return selectedSite;
};
const storageSuffix = () => (import.meta.env.DEV ? `:${site()}` : "");
const tokenKey = () => `teakOAuthCredentials${storageSuffix()}`;
const ownerKey = () => `teakOAuthOwner${storageSuffix()}`;
const discovery = (forceRefresh = false) => {
  site();
  return discoverAuthServer(
    import.meta.env.DEV ? site() : "https://teakvault.com",
    {
      forceRefresh,
      ...(import.meta.env.DEV
        ? { localIssuer: resolveTeakDevAppUrl(import.meta.env) }
        : {}),
    }
  );
};
const binding = (auth: AuthDiscovery) => ({
  siteUrl: site(),
  issuer: auth.issuer,
  clientId: auth.clients[SURFACE],
});
// Unbound credentials predate WorkOS and never match the current provider.
const matches = (credentials: Credentials, auth: AuthDiscovery) =>
  credentials.siteUrl === site() &&
  credentials.issuer === auth.issuer &&
  credentials.clientId === auth.clients[SURFACE];
async function readJson(response: Response) {
  const text = await readResponseTextWithinLimit(response, 64 * 1024);
  if (text === null) {
    throw new Error("Authentication response is too large.");
  }
  return JSON.parse(text);
}
function fetchAuth(url: string, init: RequestInit) {
  return fetch(validateOAuthUrl(url, LOCAL).href, {
    ...init,
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
}
async function refreshDiscoveryAfterFailure() {
  try {
    await discovery(true);
  } catch {
    /* Preserve the original authentication error. */
  }
}
export const AUTH_STATE_KEY = "teakOAuthState";
interface Credentials {
  accessToken: string;
  clientId?: string;
  expiresAt: number;
  issuer?: string;
  refreshToken: string;
  siteUrl?: string;
  userId?: string;
}
let ready: Promise<void> | undefined;
let login: Promise<void> | undefined;
let generation = 0;

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
      ? await firefoxCredentials("readonly", (store) => store.get(tokenKey()))
      : (await chrome.storage.local.get(tokenKey()))[tokenKey()]
  ) as Partial<Credentials> | undefined;
  return record &&
    typeof record.accessToken === "string" &&
    record.accessToken.length > 0 &&
    typeof record.refreshToken === "string" &&
    record.refreshToken.length > 0 &&
    Number.isSafeInteger(record.expiresAt)
    ? (record as Credentials)
    : null;
}

async function writeCredentials(credentials: Credentials | null) {
  if (credentials) {
    if (IS_FIREFOX) {
      await firefoxCredentials("readwrite", (store) =>
        store.put(credentials, tokenKey())
      );
    }
    await chrome.storage.local.set({
      ...(IS_FIREFOX ? {} : { [tokenKey()]: credentials }),
      ...(credentials.userId ? { [ownerKey()]: credentials.userId } : {}),
    });
  } else if (IS_FIREFOX) {
    await firefoxCredentials("readwrite", (store) => store.delete(tokenKey()));
  } else {
    await chrome.storage.local.remove(tokenKey());
  }
  await chrome.storage.local.set({
    [AUTH_STATE_KEY]: {
      authenticated: Boolean(credentials),
      pending: false,
      changedAt: Date.now(),
    },
  });
}

async function tokenRequest(
  auth: AuthDiscovery,
  params: Record<string, string>
): Promise<Credentials | null> {
  try {
    const result = await requestConnectTokens(auth, {
      clientId: auth.clients[SURFACE],
      grant: params,
      local: LOCAL,
    });
    if (result.ok) {
      return { ...binding(auth), ...result.tokens };
    }
    if (
      result.reason === "refresh_token_rejected" ||
      (result.reason === "rejected" && params.grant_type !== "refresh_token")
    ) {
      await refreshDiscoveryAfterFailure();
      return null;
    }
    if (result.reason === "rejected") {
      throw new Error("Could not verify your connection. Please try again.");
    }
    throw new Error(
      result.reason === "invalid_response"
        ? "Invalid sign-in response."
        : "Could not connect to Teak. Please try again."
    );
  } catch (error) {
    await refreshDiscoveryAfterFailure();
    throw error;
  }
}

async function revokeCredentials(
  credentials: Credentials,
  auth: AuthDiscovery,
  refreshSaved = false
) {
  if (
    !(
      credentials.siteUrl === site() &&
      credentials.clientId?.startsWith("client_") &&
      credentials.issuer
    )
  ) {
    // Credentials that predate WorkOS cannot authenticate with any Teak
    // service, so callers clear them locally.
    return;
  }
  const result = await disconnectConnectGrant(site(), credentials.accessToken, {
    local: LOCAL,
    refreshAccessToken:
      refreshSaved && matches(credentials, auth)
        ? async () => {
            const renewed = await tokenRequest(auth, {
              grant_type: "refresh_token",
              refresh_token: credentials.refreshToken,
            });
            if (!renewed) {
              return null;
            }
            renewed.userId = credentials.userId;
            // signOutOAuth holds the same lock as request refreshes.
            await writeCredentials(renewed);
            return renewed.accessToken;
          }
        : undefined,
  });
  if (result === "refresh_rejected") {
    return "Signed out on this device. To disconnect other installations, use Settings → Connected apps.";
  }
  if (result !== "disconnected") {
    throw new Error("Could not sign out. Please try again.");
  }
}

export function beginOAuthSignIn(): Promise<void> {
  login ??= (async () => {
    await initializeAuth();
    const attempt = generation;
    const auth = await discovery(true);
    const saved = await readCredentials();
    if (saved && matches(saved, auth) && !saved.userId) {
      throw new Error(
        "Sign out before reconnecting, then wait five minutes for disconnect to finish."
      );
    }
    const state = randomBase64Url(32);
    const verifier = randomBase64Url(32);
    const redirectUri = chrome.identity.getRedirectURL("oauth/callback");
    const url = createConnectAuthorizeUrl(auth, {
      clientId: auth.clients[SURFACE],
      codeChallenge: await createPkceChallenge(verifier),
      redirectUri,
      state,
    });
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
      const current = await discovery(true);
      if (
        current.issuer !== auth.issuer ||
        current.clients[SURFACE] !== auth.clients[SURFACE] ||
        attempt !== generation
      ) {
        throw new Error("Sign-in provider changed. Please try again.");
      }
      const credentials = await tokenRequest(current, {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      });
      if (!credentials) {
        throw new Error("Sign-in expired. Please try again.");
      }
      const userId = await fetchConnectOwnerId(
        site(),
        credentials.accessToken,
        { local: LOCAL }
      );
      if (!userId) {
        throw new Error("Could not verify your account. Please sign in again.");
      }
      credentials.userId = userId;
      await navigator.locks.request("teak-oauth-credentials", async () => {
        // A sign-out during sign-in discards this grant without revoking the
        // same app on other installations.
        if (attempt === generation) {
          await writeCredentials(credentials);
        }
      });
    }
  })()
    .catch(async (error) => {
      await refreshDiscoveryAfterFailure();
      throw error;
    })
    .finally(async () => {
      login = undefined;
      await chrome.storage.local.set({
        [AUTH_STATE_KEY]: { pending: false, changedAt: Date.now() },
      });
    });
  return login;
}

function credentialsForRequest() {
  return navigator.locks.request("teak-oauth-credentials", async () => {
    const attempt = generation;
    const credentials = await readCredentials();
    if (!credentials) {
      return null;
    }
    const auth = await discovery();
    if (!matches(credentials, auth)) {
      await writeCredentials(null);
      return null;
    }
    if (credentials.expiresAt > Date.now() + 30_000) {
      return attempt === generation ? credentials : null;
    }
    const renewed = await tokenRequest(auth, {
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    });
    if (renewed) {
      renewed.userId = credentials.userId;
      // Rotation invalidates the previous refresh token. Persist its replacement
      // before any further network operation; discovery outages must retain it.
      await writeCredentials(renewed);
      const current = await discovery(true);
      if (attempt !== generation && matches(renewed, current)) {
        await revokeCredentials(renewed, current);
      }
      if (!matches(renewed, current) || attempt !== generation) {
        await writeCredentials(null);
        return null;
      }
    } else {
      await writeCredentials(null);
    }
    return renewed;
  });
}

export async function oauthRequest(
  path: string,
  init: RequestInit = {},
  expectedUserId?: string
): Promise<Response | null> {
  const requestUrl = new URL(path, site());
  if (
    requestUrl.origin !== site() ||
    !path.startsWith("/") ||
    path.startsWith("//")
  ) {
    throw new Error("Invalid Teak API path.");
  }
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
  const response = await fetchAuth(requestUrl.href, {
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
    await refreshDiscoveryAfterFailure();
    return null;
  }
  return response;
}

export async function getOAuthState() {
  const response = await oauthRequest("/v1/me");
  if (!response) {
    const state = (await chrome.storage.local.get(AUTH_STATE_KEY))[
      AUTH_STATE_KEY
    ];
    const notice =
      typeof state === "object" &&
      state !== null &&
      "notice" in state &&
      typeof state.notice === "string"
        ? state.notice
        : undefined;
    return {
      authenticated: false,
      pending: Boolean(login),
      ...(notice ? { notice } : {}),
    };
  }
  if (!response.ok) {
    throw new Error("Could not load your account.");
  }
  const user = (await readJson(response)).data;
  if (!user || typeof user.id !== "string" || !user.id) {
    throw new Error("Invalid account response.");
  }
  return {
    authenticated: true,
    pending: Boolean(login),
    user: {
      id: user.id,
      email: typeof user.email === "string" ? user.email : "",
      name: typeof user.name === "string" ? user.name : undefined,
    },
  };
}

export async function signOutOAuth() {
  generation += 1;
  return await navigator.locks.request("teak-oauth-credentials", async () => {
    const credentials = await readCredentials();
    const notice = credentials
      ? await revokeCredentials(credentials, await discovery(true), true)
      : undefined;
    await writeCredentials(null);
    await chrome.storage.local.remove(ownerKey());
    if (notice) {
      await chrome.storage.local.set({
        [AUTH_STATE_KEY]: { pending: false, changedAt: Date.now(), notice },
      });
    }
    return notice;
  });
}

export async function getCaptureOwner(): Promise<string | undefined> {
  await initializeAuth();
  const owner = (await chrome.storage.local.get(ownerKey()))[ownerKey()];
  return typeof owner === "string" ? owner : undefined;
}
