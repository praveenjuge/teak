import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { buildWebUrl, getDesktopConfig } from "@/lib/desktop-config";

// ── Constants ──────────────────────────────────────────────────────────────────

const SESSION_TOKEN_KEY = "auth.sessionToken";
const PENDING_AUTH_KEY = "auth.pendingNativeFlow";
const DESKTOP_PENDING_MAX_AGE_MS = 10 * 60 * 1000;
const JWT_EXPIRY_SKEW_MS = 10_000;

// Desktop OAuth client (matches the trusted client registered server-side).
const DESKTOP_OAUTH_CLIENT_ID = "teak-desktop";
const DESKTOP_OAUTH_SCOPE = "openid profile email offline_access";
const OAUTH_REDIRECT_HOST = "127.0.0.1";

// ── Types ──────────────────────────────────────────────────────────────────────

interface NativeAuthState {
  isInitialized: boolean;
  sessionToken: string | null;
}

interface PendingDesktopOAuth {
  codeVerifier: string;
  createdAt: number;
  port: number;
  state: string;
}

interface CachedJwt {
  expiresAt: number;
  token: string;
}

interface ExchangeResponse {
  expiresAt: number;
  sessionToken: string;
}

export type DesktopOAuthResult = "authenticated" | "timeout" | "cancelled";

// ── Validation patterns ────────────────────────────────────────────────────────

const PKCE_CODE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const CALLBACK_STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

// ── Store helpers (thin wrappers over the preload bridge) ──────────────────────

function readStoreValue<T>(key: string): Promise<T | null> {
  return window.teakDesktop.store.read<T>(key);
}

function writeStoreValue(key: string, value: unknown): Promise<void> {
  return window.teakDesktop.store.write(key, value);
}

// ── External store for React ───────────────────────────────────────────────────

let state: NativeAuthState = {
  isInitialized: false,
  sessionToken: null,
};

let cachedJwt: CachedJwt | null = null;
let initializationPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): NativeAuthState {
  return state;
}

function setState(nextState: NativeAuthState) {
  state = nextState;
  notifyListeners();
}

// ── Crypto helpers ─────────────────────────────────────────────────────────────

const { convexSiteBaseUrl } = getDesktopConfig();

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  return normalized + "=".repeat(padLength);
}

function randomBase64Url(size: number): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function timingSafeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length === right.length ? 0 : 1;
  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = left.charCodeAt(index) || 0;
    const rightCode = right.charCodeAt(index) || 0;
    mismatch |= leftCode ^ rightCode;
  }
  return mismatch === 0;
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );
  return toBase64Url(new Uint8Array(digest));
}

function parseJwtExpiry(token: string): number | null {
  const tokenParts = token.split(".");
  if (tokenParts.length !== 3) {
    return null;
  }

  try {
    const payloadJson = atob(fromBase64Url(tokenParts[1]));
    const payload = JSON.parse(payloadJson) as { exp?: unknown };
    if (typeof payload.exp !== "number") {
      return null;
    }
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

// ── Initialization ─────────────────────────────────────────────────────────────

async function ensureInitialized(): Promise<void> {
  if (state.isInitialized) {
    return;
  }

  if (!initializationPromise) {
    initializationPromise = (async () => {
      const sessionToken = await readStoreValue<string>(SESSION_TOKEN_KEY);
      setState({
        isInitialized: true,
        sessionToken:
          typeof sessionToken === "string" && sessionToken.trim()
            ? sessionToken
            : null,
      });
    })().finally(() => {
      initializationPromise = null;
    });
  }

  await initializationPromise;
}

// ── Session management ─────────────────────────────────────────────────────────

async function setSessionToken(sessionToken: string): Promise<void> {
  await writeStoreValue(SESSION_TOKEN_KEY, sessionToken);
  cachedJwt = null;
  setState({
    isInitialized: true,
    sessionToken,
  });
}

export async function clearNativeSessionToken(): Promise<void> {
  await writeStoreValue(SESSION_TOKEN_KEY, null);
  cachedJwt = null;
  setState({
    isInitialized: true,
    sessionToken: null,
  });
}

async function getNativeSessionToken(): Promise<string | null> {
  await ensureInitialized();
  return state.sessionToken;
}

// ── Auth flow (browser OAuth) ────────────────────────────────────────────────

/**
 * Begin the desktop OAuth flow. Starts the loopback callback listener, persists
 * a pending PKCE record, and returns the authorize URL to open in the browser.
 * The URL targets the web origin so the browser's session cookie authenticates
 * the request; unauthenticated users hit the login page and resume afterward.
 */
export async function startDesktopOAuthRequest(): Promise<string> {
  const stateToken = randomBase64Url(18);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await createCodeChallenge(codeVerifier);

  const { port } = await window.teakDesktop.oauth.listen();

  const pendingAuth: PendingDesktopOAuth = {
    codeVerifier,
    createdAt: Date.now(),
    port,
    state: stateToken,
  };
  await writeStoreValue(PENDING_AUTH_KEY, pendingAuth);

  const url = new URL(buildWebUrl("/api/auth/mcp/authorize"));
  url.searchParams.set("client_id", DESKTOP_OAUTH_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "redirect_uri",
    `http://${OAUTH_REDIRECT_HOST}:${port}/oauth/callback`
  );
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", stateToken);
  url.searchParams.set("scope", DESKTOP_OAUTH_SCOPE);
  return url.toString();
}

interface TokenExchangeResponse {
  access_token?: unknown;
}

async function exchangeCodeForAccessToken(params: {
  code: string;
  codeVerifier: string;
  port: number;
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: DESKTOP_OAUTH_CLIENT_ID,
    code: params.code,
    code_verifier: params.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: `http://${OAUTH_REDIRECT_HOST}:${params.port}/oauth/callback`,
  });

  const response = await fetch(`${convexSiteBaseUrl}/api/auth/mcp/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error("Failed to exchange authorization code");
  }

  const data = (await response.json()) as TokenExchangeResponse;
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("Authorization code exchange returned no access token");
  }
  return data.access_token;
}

async function exchangeAccessTokenForSession(
  accessToken: string
): Promise<ExchangeResponse> {
  const response = await fetch(
    `${convexSiteBaseUrl}/api/native/auth/oauth-exchange`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to establish a desktop session");
  }

  const data = (await response.json()) as Partial<ExchangeResponse>;
  if (typeof data.sessionToken !== "string" || !data.sessionToken) {
    throw new Error("Desktop session exchange response is invalid");
  }

  return {
    sessionToken: data.sessionToken,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : Date.now(),
  };
}

/**
 * Complete the desktop OAuth flow from the loopback callback. Verifies the
 * state (timing-safe), exchanges the code for an access token, then trades that
 * for a dedicated desktop session token which is persisted for Convex auth.
 */
export async function completeDesktopOAuth(
  code: string,
  state: string
): Promise<DesktopOAuthResult> {
  const pending = await readStoreValue<PendingDesktopOAuth>(PENDING_AUTH_KEY);
  if (!pending) {
    return "cancelled";
  }

  // Consume the pending record up front so a code can only be redeemed once.
  await writeStoreValue(PENDING_AUTH_KEY, null);

  if (Date.now() - pending.createdAt > DESKTOP_PENDING_MAX_AGE_MS) {
    return "timeout";
  }

  if (
    !(
      CALLBACK_STATE_PATTERN.test(pending.state) &&
      PKCE_CODE_PATTERN.test(pending.codeVerifier) &&
      timingSafeEqual(pending.state, state)
    )
  ) {
    return "cancelled";
  }

  try {
    const accessToken = await exchangeCodeForAccessToken({
      code,
      codeVerifier: pending.codeVerifier,
      port: pending.port,
    });
    const session = await exchangeAccessTokenForSession(accessToken);
    await setSessionToken(session.sessionToken);
    return "authenticated";
  } catch {
    return "cancelled";
  }
}

/** Abort an in-flight desktop OAuth attempt and tear down the loopback listener. */
export async function cancelDesktopOAuth(): Promise<void> {
  await writeStoreValue(PENDING_AUTH_KEY, null);
  await window.teakDesktop.oauth.cancel();
}

// ── JWT fetching ───────────────────────────────────────────────────────────────

async function fetchConvexJwt(
  sessionToken: string,
  forceRefreshToken: boolean
): Promise<string | null> {
  if (
    cachedJwt &&
    !forceRefreshToken &&
    cachedJwt.expiresAt > Date.now() + JWT_EXPIRY_SKEW_MS
  ) {
    return cachedJwt.token;
  }

  const response = await fetch(`${convexSiteBaseUrl}/api/auth/convex/token`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });

  if (response.status === 401 || response.status === 403) {
    await clearNativeSessionToken();
    return null;
  }

  if (!response.ok) {
    throw new Error("Failed to fetch Convex auth token");
  }

  const data = (await response.json()) as { token?: unknown };
  if (typeof data.token !== "string" || !data.token) {
    throw new Error("Convex auth token response is invalid");
  }

  const expiresAt = parseJwtExpiry(data.token) ?? Date.now() + 5 * 60 * 1000;
  cachedJwt = {
    token: data.token,
    expiresAt,
  };

  return data.token;
}

// ── Logout ─────────────────────────────────────────────────────────────────────

export async function logoutNativeSession(): Promise<void> {
  const sessionToken = await getNativeSessionToken();

  if (sessionToken) {
    await fetch(`${convexSiteBaseUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    }).catch(() => undefined);
  }

  await clearNativeSessionToken();
  await writeStoreValue(PENDING_AUTH_KEY, null);
}

// ── React hook for ConvexProviderWithAuth ──────────────────────────────────────

export function useNativeConvexAuth() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void ensureInitialized();
  }, []);

  const fetchAccessToken = useCallback(
    async ({
      forceRefreshToken = false,
    }: {
      forceRefreshToken?: boolean;
    } = {}): Promise<string | null> => {
      await ensureInitialized();
      const sessionToken = getSnapshot().sessionToken;
      if (!sessionToken) {
        return null;
      }

      return fetchConvexJwt(sessionToken, forceRefreshToken);
    },
    []
  );

  return useMemo(
    () => ({
      isLoading: !snapshot.isInitialized,
      isAuthenticated: Boolean(snapshot.sessionToken),
      fetchAccessToken,
    }),
    [fetchAccessToken, snapshot.isInitialized, snapshot.sessionToken]
  );
}
