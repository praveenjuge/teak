import { resolveTeakDevAppUrl } from "@teak/convex/devUrls";
import { readResponseTextWithinLimit } from "@teak/convex/shared/boundedResponse";
import {
  type AuthDiscovery,
  createConnectAuthorizeUrl,
  createPkceChallenge,
  disconnectConnectGrant,
  discoverAuthServer,
  fetchConnectOwnerId,
  isRefreshTokenDead,
  isWorkosCredential,
  matchesBinding,
  randomBase64Url,
  refreshAndSave,
  requestConnectTokens,
  validateOAuthUrl,
} from "teak-sdk";
import { captureOwnerKey, siteStorageKey, teakSite } from "./captureOwner";
import { rememberAccountLocale } from "./locale";
import { isPrivateSession } from "./privateSession";
import { recordApiRequest } from "./requestBudget";
import { captureExtensionEvent } from "./telemetry";

const IS_FIREFOX = import.meta.env.BROWSER === "firefox";
const SURFACE = IS_FIREFOX ? "firefox" : "chrome";
const LOCAL = Boolean(import.meta.env.DEV);
const tokenKey = () => siteStorageKey("teakOAuthCredentials");
const discovery = (forceRefresh = false) => {
  teakSite();
  return discoverAuthServer(
    import.meta.env.DEV ? teakSite() : "https://teakvault.com",
    {
      forceRefresh,
      ...(import.meta.env.DEV
        ? { localIssuer: resolveTeakDevAppUrl(import.meta.env) }
        : {}),
    }
  );
};
const binding = (auth: AuthDiscovery) => ({
  siteUrl: teakSite(),
  issuer: auth.issuer,
  clientId: auth.clients[SURFACE],
});
const savedBinding = (credentials: Credentials) => ({
  origin: credentials.siteUrl,
  issuer: credentials.issuer,
  clientId: credentials.clientId,
});
const matches = (credentials: Credentials, auth: AuthDiscovery) =>
  matchesBinding(savedBinding(credentials), {
    origin: teakSite(),
    issuer: auth.issuer,
    clientId: auth.clients[SURFACE],
  });
async function readJson(response: Response) {
  const text = await readResponseTextWithinLimit(response, 64 * 1024);
  if (text === null) {
    throw new Error("Authentication response is too large.");
  }
  return JSON.parse(text);
}
export const UNREACHABLE_MESSAGE =
  "Couldn't reach Teak. Check your connection and try again.";
/** Each browser words a network failure differently ("Failed to fetch",
 * "NetworkError when attempting to fetch resource."); this says it once. */
export const reachTeak = <T>(request: Promise<T>) =>
  request.catch((error: unknown) => {
    throw error instanceof TypeError ? new Error(UNREACHABLE_MESSAGE) : error;
  });

function fetchAuth(url: string, init: RequestInit) {
  return reachTeak(
    // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
    fetch(validateOAuthUrl(url, LOCAL).href, {
      ...init,
      credentials: "omit",
      redirect: "error",
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    })
  );
}
const refreshDiscoveryAfterFailure = () =>
  discovery(true).then(
    () => undefined,
    () => undefined
  );
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
let signOutEpoch = 0;
const signedOutSince = (epoch: number) => epoch !== signOutEpoch;

// Firefox and older Chromium builds can't restrict storage.local to trusted
// extension contexts (Chromium's setAccessLevel is missing there, and calling
// it threw before the background could start).
const canProtectLocalStorage = () =>
  !IS_FIREFOX && typeof chrome.storage.local.setAccessLevel === "function";

export function initializeAuth() {
  ready ??= canProtectLocalStorage()
    ? protectLocalStorage()
    : Promise.resolve();
  return ready;
}

async function protectLocalStorage() {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  try {
    await moveDatabaseCredentials();
  } catch {
    // The sign-in stays where it was; failing here must not block sign-in.
  }
}

const CREDENTIAL_DATABASE = "teak-oauth";

// A sign-in kept in IndexedDB while the browser lacked setAccessLevel moves to
// the protected storage.local once a browser update adds it, so the update
// doesn't sign anyone out. Browsers that never needed the database skip it.
async function moveDatabaseCredentials() {
  const databases = await globalThis.indexedDB?.databases?.();
  if (!databases?.some(({ name }) => name === CREDENTIAL_DATABASE)) {
    return;
  }
  const saved = await databaseCredentials.read();
  if (saved === undefined) {
    return;
  }
  if ((await chrome.storage.local.get(tokenKey()))[tokenKey()] === undefined) {
    await chrome.storage.local.set({ [tokenKey()]: saved });
  }
  await databaseCredentials.clear();
}

// Where storage.local can't be protected, the extension-origin IndexedDB holds
// the sign-in: content scripts can't read it, and it survives background-page
// restarts. Chromium with setAccessLevel keeps its existing protected storage.
async function withCredentialDatabase<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(CREDENTIAL_DATABASE, 1);
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

interface CredentialStore {
  clear: () => Promise<void>;
  read: () => Promise<unknown>;
  write: (
    credentials: Credentials,
    localFields: Record<string, unknown>
  ) => Promise<void>;
}

const databaseCredentials: CredentialStore = {
  read: () =>
    withCredentialDatabase("readonly", (store) => store.get(tokenKey())),
  write: async (credentials, localFields) => {
    await withCredentialDatabase("readwrite", (store) =>
      store.put(credentials, tokenKey())
    );
    await chrome.storage.local.set(localFields);
  },
  clear: async () => {
    await withCredentialDatabase("readwrite", (store) =>
      store.delete(tokenKey())
    );
  },
};

const storageAreaCredentials = (
  area: chrome.storage.StorageArea
): CredentialStore => ({
  read: async () => (await area.get(tokenKey()))[tokenKey()],
  write: async (credentials, localFields) => {
    if (area === chrome.storage.local) {
      await area.set({ ...localFields, [tokenKey()]: credentials });
      return;
    }
    await area.set({ [tokenKey()]: credentials });
    await chrome.storage.local.set(localFields);
  },
  clear: () => area.remove(tokenKey()),
});

const credentialStore = (): CredentialStore => {
  if (canProtectLocalStorage()) {
    return storageAreaCredentials(chrome.storage.local);
  }
  // A private session can't open IndexedDB; its session storage, which the
  // browser never shows content scripts, holds the sign-in until it closes.
  return isPrivateSession()
    ? storageAreaCredentials(chrome.storage.session)
    : databaseCredentials;
};

async function readCredentials(): Promise<Credentials | null> {
  await initializeAuth();
  const record = (await credentialStore().read()) as
    | Partial<Credentials>
    | undefined;
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
    await credentialStore().write(
      credentials,
      credentials.userId ? { [captureOwnerKey()]: credentials.userId } : {}
    );
  } else {
    await credentialStore().clear();
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
      const { accessToken, expiresAt, refreshToken } = result.tokens;
      return { ...binding(auth), accessToken, expiresAt, refreshToken };
    }
    const rejected =
      result.reason === "rejected" || result.reason === "client_rejected";
    if (
      isRefreshTokenDead(result) ||
      (rejected && params.grant_type !== "refresh_token")
    ) {
      await refreshDiscoveryAfterFailure();
      return null;
    }
    if (rejected) {
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

const refreshCredentials = (credentials: Credentials, auth: AuthDiscovery) =>
  refreshAndSave(async () => {
    const renewed = await tokenRequest(auth, {
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    });
    return renewed && { ...renewed, userId: credentials.userId };
  }, writeCredentials);

async function revokeCredentials(
  credentials: Credentials,
  auth: AuthDiscovery,
  refreshSaved = false
) {
  const saved = savedBinding(credentials);
  if (!isWorkosCredential(saved) || saved.origin !== teakSite()) {
    return;
  }
  const result = await disconnectConnectGrant(
    teakSite(),
    credentials.accessToken,
    {
      local: LOCAL,
      refreshAccessToken:
        refreshSaved && matches(credentials, auth)
          ? async () =>
              (await refreshCredentials(credentials, auth))?.accessToken ?? null
          : undefined,
    }
  );
  if (result === "refresh_rejected") {
    return "Signed out on this device. To disconnect other installations, use Settings → Security → Connected apps.";
  }
  if (result !== "disconnected") {
    throw new Error("Could not sign out. Please try again.");
  }
}

export function beginOAuthSignIn(): Promise<void> {
  login ??= (async () => {
    await initializeAuth();
    const startedAt = signOutEpoch;
    const auth = await discovery(true);
    const saved = await readCredentials();
    if (saved && matches(saved, auth) && !saved.userId) {
      throw new Error(
        "Sign out before reconnecting, then wait 15 minutes for disconnect to finish."
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
        signedOutSince(startedAt)
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
        teakSite(),
        credentials.accessToken,
        { local: LOCAL }
      );
      if (!userId) {
        throw new Error("Could not verify your account. Please sign in again.");
      }
      credentials.userId = userId;
      await navigator.locks.request("teak-oauth-credentials", async () => {
        if (!signedOutSince(startedAt)) {
          await writeCredentials(credentials);
        }
      });
      await captureExtensionEvent("signed_in", {});
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
    const readAt = signOutEpoch;
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
      return signedOutSince(readAt) ? null : credentials;
    }
    const renewed = await refreshCredentials(credentials, auth);
    if (renewed) {
      const current = await discovery();
      if (signedOutSince(readAt) && matches(renewed, current)) {
        await revokeCredentials(renewed, current);
      }
      if (!matches(renewed, current) || signedOutSince(readAt)) {
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
  const requestUrl = new URL(path, teakSite());
  if (
    requestUrl.origin !== teakSite() ||
    !path.startsWith("/") ||
    path.startsWith("//")
  ) {
    throw new Error("Invalid Teak API path.");
  }
  const credentials = await reachTeak(credentialsForRequest());
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
  recordApiRequest();
  const response = await fetchAuth(requestUrl.href, {
    ...init,
    headers,
    credentials: "omit",
    redirect: "error",
  });
  if (response.status === 401) {
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
  // The popup, menus and omnibox follow the account's language.
  await rememberAccountLocale(user.locale).catch(() => undefined);
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
  signOutEpoch += 1;
  return await navigator.locks.request("teak-oauth-credentials", async () => {
    const credentials = await readCredentials();
    const notice = credentials
      ? await revokeCredentials(credentials, await discovery(true), true)
      : undefined;
    await writeCredentials(null);
    await chrome.storage.local.remove(captureOwnerKey());
    if (notice) {
      await chrome.storage.local.set({
        [AUTH_STATE_KEY]: { pending: false, changedAt: Date.now(), notice },
      });
    }
    return notice;
  });
}
