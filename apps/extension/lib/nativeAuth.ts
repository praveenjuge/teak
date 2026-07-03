import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";

// Browser-login device-poll flow shared by the popup, background, and the
// completion-page content script. The extension no longer reads the web app's
// session cookie; instead it holds its own long-lived, revocable Better Auth
// session token (minted per device by the server) in chrome.storage.local and
// exchanges it for short-lived Convex JWTs.

// chrome.storage.local keys.
export const SESSION_TOKEN_KEY = "teakSessionToken";
const DEVICE_ID_KEY = "teakNativeDeviceId";
export const PENDING_AUTH_KEY = "teakPendingNativeAuth";

// Pending sign-in attempts expire alongside the server's auth-code TTL (5 min).
const PENDING_TTL_MS = 5 * 60 * 1000;

// Generic surface for browser extensions; per-browser surfaces can be added
// later without a server change beyond widening the union.
const NATIVE_AUTH_SURFACE = "browser-extension";

// Mirrors the server-side validators in packages/convex/authNative.ts.
const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{16,128}$/;

const WEB_APP_BASE_URL = import.meta.env.DEV
  ? resolveTeakDevAppUrl(import.meta.env)
  : "https://app.teakvault.com";

export interface PendingNativeAuth {
  codeVerifier: string;
  createdAt: number;
  state: string;
}

export type PollOutcome = "authenticated" | "pending" | "error" | "no-pending";

// Better Auth + native-auth endpoints are hit on the Convex site URL (https),
// NOT the web app URL. In dev the web app is served over https and force-
// upgrades http->https; browsers strip the `Authorization: Bearer` header on
// that cross-scheme redirect, so bearer-authenticated calls to the web app URL
// silently lose auth. The Convex site is hit directly (no redirect), matching
// how the desktop and Safari clients call these endpoints.
export const getConvexSiteUrl = (): string => {
  const url = import.meta.env.VITE_PUBLIC_CONVEX_SITE_URL;
  if (!url) {
    throw new Error("Missing VITE_PUBLIC_CONVEX_SITE_URL in extension runtime");
  }
  return url;
};

// ── PKCE helpers (S256, base64url) ──────────────────────────────────────────

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const randomBase64Url = (size: number): string => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
};

export const createCodeChallenge = async (
  codeVerifier: string
): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );
  return toBase64Url(new Uint8Array(digest));
};

// ── Storage helpers ─────────────────────────────────────────────────────────

const readLocal = async (key: string): Promise<unknown> => {
  const result = await chrome.storage.local.get(key);
  return result[key];
};

const writeLocal = (key: string, value: unknown): Promise<void> =>
  chrome.storage.local.set({ [key]: value });

const removeLocal = (keys: string | string[]): Promise<void> =>
  chrome.storage.local.remove(keys);

const isPendingNativeAuth = (value: unknown): value is PendingNativeAuth =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as PendingNativeAuth).codeVerifier === "string" &&
      typeof (value as PendingNativeAuth).state === "string" &&
      typeof (value as PendingNativeAuth).createdAt === "number"
  );

// ── Session token ───────────────────────────────────────────────────────────

export async function getSessionToken(): Promise<string | null> {
  const token = await readLocal(SESSION_TOKEN_KEY);
  return typeof token === "string" && token.trim() ? token : null;
}

/**
 * Drop the locally stored session + any pending flow. The persistent device id
 * is intentionally preserved so the same device keeps a stable identity.
 */
export function clearLocalSession(): Promise<void> {
  return removeLocal([SESSION_TOKEN_KEY, PENDING_AUTH_KEY]);
}

// ── Device id (persistent) ──────────────────────────────────────────────────

async function getDeviceId(): Promise<string> {
  const existing = await readLocal(DEVICE_ID_KEY);
  if (typeof existing === "string" && DEVICE_ID_PATTERN.test(existing)) {
    return existing;
  }
  const deviceId = crypto.randomUUID();
  await writeLocal(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

// ── Pending sign-in flow ────────────────────────────────────────────────────

export async function readPendingNativeAuth(): Promise<PendingNativeAuth | null> {
  const pending = await readLocal(PENDING_AUTH_KEY);
  if (!isPendingNativeAuth(pending)) {
    return null;
  }
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    await removeLocal(PENDING_AUTH_KEY);
    return null;
  }
  return pending;
}

export async function hasPendingFlow(): Promise<boolean> {
  return (await readPendingNativeAuth()) !== null;
}

/**
 * Mint a fresh PKCE verifier + state, persist the pending record, and return
 * the /native/auth/start URL to open in a browser tab. Unauthenticated users
 * are bounced to /login?next=… by the start route and resume automatically.
 */
export async function beginSignIn(): Promise<string> {
  const deviceId = await getDeviceId();
  const state = randomBase64Url(18);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await createCodeChallenge(codeVerifier);

  const pending: PendingNativeAuth = {
    codeVerifier,
    createdAt: Date.now(),
    state,
  };
  await writeLocal(PENDING_AUTH_KEY, pending);

  const url = new URL(`${WEB_APP_BASE_URL}/native/auth/start`);
  url.searchParams.set("device_id", deviceId);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("state", state);
  url.searchParams.set("surface", NATIVE_AUTH_SURFACE);
  // The start route validates redirect_uri against a strict allowlist and
  // rejects any that carry query params, so keep it clean.
  url.searchParams.set(
    "redirect_uri",
    `${WEB_APP_BASE_URL}/native/auth/complete`
  );
  return url.toString();
}

/**
 * Run a single poll against the device-poll endpoint. Callers should serialize
 * calls (the auth code is single-use). Stores the session token on success and
 * clears the pending record on terminal outcomes; transient failures (network,
 * 429, 5xx) keep the pending record so a later poll can retry.
 */
export async function pollPendingNativeAuth(): Promise<PollOutcome> {
  const pending = await readPendingNativeAuth();
  if (!pending) {
    return "no-pending";
  }
  const deviceId = await getDeviceId();

  let response: Response;
  try {
    response = await fetch(`${getConvexSiteUrl()}/api/native/auth/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codeVerifier: pending.codeVerifier,
        deviceId,
        state: pending.state,
      }),
    });
  } catch {
    // Network error: keep pending for a later retry.
    return "error";
  }

  // 204: the web side hasn't authorized the code yet — keep polling.
  if (response.status === 204) {
    return "pending";
  }

  if (response.status === 200) {
    const data = (await response.json().catch(() => null)) as {
      sessionToken?: unknown;
    } | null;
    if (
      data &&
      typeof data.sessionToken === "string" &&
      data.sessionToken.trim()
    ) {
      await writeLocal(SESSION_TOKEN_KEY, data.sessionToken);
      await removeLocal(PENDING_AUTH_KEY);
      return "authenticated";
    }
    // Malformed 200: drop the pending flow to avoid a stuck state.
    await removeLocal(PENDING_AUTH_KEY);
    return "error";
  }

  // 400/401: invalid or expired code/state — the user must restart sign-in.
  if (response.status === 400 || response.status === 401) {
    await removeLocal(PENDING_AUTH_KEY);
    return "error";
  }

  // 429 / 5xx: transient — keep pending so a later poll can retry.
  return "error";
}

/**
 * Best-effort server-side sign-out. Because the extension holds a dedicated
 * session, revoking it via bearer only tears down this device's session and
 * never the user's web browser session. Always clears local state afterward.
 */
export async function signOut(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    try {
      await fetch(`${getConvexSiteUrl()}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        credentials: "omit",
      });
    } catch {
      // Ignore: the local clear below is what matters for this device.
    }
  }
  await clearLocalSession();
}
