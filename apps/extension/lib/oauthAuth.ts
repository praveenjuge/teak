import { resolveTeakDevAppUrl } from "@teak/convex/devUrls";
import {
  createOAuthSession,
  createTeakClient,
  type OAuthCredentials,
  type OAuthFailure,
  type OAuthSession,
  OAuthSessionError,
  TeakApiError,
  type TeakClient,
} from "teak-sdk";
import {
  captureOwnerKey,
  legacyTeakSite,
  siteStorageKey,
  teakSite,
} from "./captureOwner";
import { rememberAccountLocale } from "./locale";
import { isPrivateSession } from "./privateSession";
import { recordApiRequest } from "./requestBudget";
import { captureExtensionEvent } from "./telemetry";

const IS_FIREFOX = import.meta.env.BROWSER === "firefox";
const SURFACE = IS_FIREFOX ? "firefox" : "chrome";
const tokenKey = () => siteStorageKey("teakOAuthCredentials");

export const UNREACHABLE_MESSAGE =
  "Couldn't reach Teak. Check your connection and try again.";

/** What went wrong signing in, in the extension's words. */
const SIGN_IN_WORDS: Record<OAuthFailure, string> = {
  account_changed:
    "Your account changed. Sign in to the original account to finish this save.",
  account_unverified: "Could not verify your account. Please sign in again.",
  cancelled: "Sign-in was canceled.",
  not_verified: "Sign-in could not be verified.",
  previous_kept:
    "Could not sign out of your earlier account. Please try again.",
  provider_changed: "Sign-in provider changed. Please try again.",
  sign_out_first:
    "Sign out before reconnecting, then wait 15 minutes for disconnect to finish.",
  signed_out: "Sign-in was canceled because you signed out.",
  token_rejected: "Could not connect to Teak. Please try again.",
  unexpected_issuer: "Sign-in provider changed. Please try again.",
};

/**
 * A failure from the SDK in the extension's words: each browser words a
 * network failure differently ("Failed to fetch", "NetworkError when
 * attempting to fetch resource."), and the SDK says it once.
 */
export const inExtensionWords = (error: unknown): unknown => {
  if (error instanceof OAuthSessionError) {
    return new Error(SIGN_IN_WORDS[error.reason]);
  }
  if (error instanceof TeakApiError && error.kind === "network") {
    return new Error(UNREACHABLE_MESSAGE);
  }
  return error instanceof TypeError ? new Error(UNREACHABLE_MESSAGE) : error;
};

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

// A sign-in saved while the extension called the Convex site URL directly
// is bound to it; it moves to the API URL, whose tokens are the same, so the
// move to teakvault.com/api signs nobody out (.agents/records/sunset.md).
const savedOrigin = (siteUrl: string) =>
  siteUrl === legacyTeakSite() ? teakSite() : siteUrl;

// The saved shape stays as it was, so an update signs nobody out.
const fromSaved = (saved: Credentials | null): OAuthCredentials | null =>
  saved && {
    accessToken: saved.accessToken,
    expiresAt: saved.expiresAt,
    refreshToken: saved.refreshToken,
    ...(saved.siteUrl ? { origin: savedOrigin(saved.siteUrl) } : {}),
    ...(saved.issuer ? { issuer: saved.issuer } : {}),
    ...(saved.clientId ? { clientId: saved.clientId } : {}),
    ...(saved.userId ? { ownerId: saved.userId } : {}),
  };
const toSaved = (credentials: OAuthCredentials): Credentials => ({
  accessToken: credentials.accessToken,
  expiresAt: credentials.expiresAt,
  refreshToken: credentials.refreshToken,
  ...(credentials.origin ? { siteUrl: credentials.origin } : {}),
  ...(credentials.issuer ? { issuer: credentials.issuer } : {}),
  ...(credentials.clientId ? { clientId: credentials.clientId } : {}),
  ...(credentials.ownerId ? { userId: credentials.ownerId } : {}),
});

let session: OAuthSession | undefined;
/** The extension's sign-in: kept in protected storage, one change at a time. */
const oauthSession = (): OAuthSession => {
  session ??= createOAuthSession({
    apiUrl: teakSite(),
    authSiteUrl: import.meta.env.DEV ? teakSite() : "https://teakvault.com",
    surface: SURFACE,
    ...(import.meta.env.DEV
      ? { localIssuer: resolveTeakDevAppUrl(import.meta.env) }
      : {}),
    lock: (work) => navigator.locks.request("teak-oauth-credentials", work),
    store: {
      read: async () => fromSaved(await readCredentials()),
      write: (credentials) =>
        writeCredentials(credentials && toSaved(credentials)),
    },
  });
  return session;
};

// Counts Teak API requests for the saved-page badge's budget, and keeps
// cookies and redirects out of them.
const teakFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const base = teakSite();
  if (url.href === base || url.href.startsWith(`${base}/`)) {
    recordApiRequest();
  }
  return fetch(input, { ...init, credentials: "omit", redirect: "error" });
}) as typeof fetch;

/**
 * The Teak API as the signed-in user. A 401 refreshes the sign-in; only a
 * refresh Teak refuses signs out. With `ownerId`, a sign-in for another
 * account is refused instead of used.
 */
export const teakClient = (
  options: { ownerId?: string; retries?: number } = {}
): TeakClient =>
  createTeakClient({
    baseUrl: teakSite(),
    fetch: teakFetch,
    ...(options.retries === undefined ? {} : { retries: options.retries }),
    tokenProvider: oauthSession().tokenProvider({
      ownerId: options.ownerId,
    }),
    userAgent: "teak-extension",
  });

/** Whether a failure means there is no usable sign-in. */
export const isSignedOut = (error: unknown) =>
  error instanceof TeakApiError &&
  error.kind === "auth" &&
  !(error instanceof OAuthSessionError);

export function beginOAuthSignIn(): Promise<void> {
  login ??= (async () => {
    await initializeAuth();
    await chrome.storage.local.set({ [AUTH_STATE_KEY]: { pending: true } });
    await oauthSession().signIn({
      redirectUri: chrome.identity.getRedirectURL("oauth/callback"),
      authorize: async (url) =>
        (await chrome.identity.launchWebAuthFlow({
          url: url.toString(),
          interactive: true,
        })) ?? null,
    });
    await captureExtensionEvent("signed_in", {});
  })()
    .catch((error: unknown) => {
      throw inExtensionWords(error);
    })
    .finally(async () => {
      login = undefined;
      await chrome.storage.local.set({
        [AUTH_STATE_KEY]: { pending: false, changedAt: Date.now() },
      });
    });
  return login;
}

export interface OAuthState {
  authenticated: boolean;
  notice?: string;
  pending: boolean;
  user?: { email: string; id: string; name?: string };
}

const signedOutState = async (): Promise<OAuthState> => {
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
};

export async function getOAuthState(): Promise<OAuthState> {
  let user: Awaited<ReturnType<TeakClient["me"]>>;
  try {
    user = await teakClient().me();
  } catch (error) {
    if (isSignedOut(error)) {
      return await signedOutState();
    }
    const failure = inExtensionWords(error);
    throw failure instanceof TeakApiError
      ? new Error("Could not load your account.")
      : failure;
  }
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

const SIGNED_OUT_HERE =
  "Signed out on this device. To disconnect other installations, use Settings → Security → Connected apps.";

export async function signOutOAuth() {
  await initializeAuth();
  let result: Awaited<ReturnType<OAuthSession["signOut"]>>;
  try {
    result = await oauthSession().signOut();
  } catch (error) {
    throw error instanceof TeakApiError || error instanceof Error
      ? new Error("Could not sign out. Please try again.")
      : error;
  }
  await chrome.storage.local.remove(captureOwnerKey());
  if (result === "signed-out-here") {
    await chrome.storage.local.set({
      [AUTH_STATE_KEY]: {
        pending: false,
        changedAt: Date.now(),
        notice: SIGNED_OUT_HERE,
      },
    });
    return SIGNED_OUT_HERE;
  }
}
