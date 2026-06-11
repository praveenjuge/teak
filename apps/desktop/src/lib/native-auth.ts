import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { buildWebUrl, getDesktopConfig } from "@/lib/desktop-config";

// ── Constants ──────────────────────────────────────────────────────────────────

const SESSION_TOKEN_KEY = "auth.sessionToken";
const DEVICE_ID_KEY = "auth.deviceId";
const PENDING_AUTH_KEY = "auth.pendingNativeFlow";
const DESKTOP_PENDING_MAX_AGE_MS = 10 * 60 * 1000;
const DESKTOP_AUTH_POLL_INTERVAL_MS = 2000;
const JWT_EXPIRY_SKEW_MS = 10_000;

// ── Types ──────────────────────────────────────────────────────────────────────

interface NativeAuthState {
  isInitialized: boolean;
  sessionToken: string | null;
}

interface PendingNativeAuth {
  codeVerifier: string;
  createdAt: number;
  deviceId: string;
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

export type NativeAuthPollingResult = "authenticated" | "timeout" | "cancelled";

// ── Validation patterns ────────────────────────────────────────────────────────

const PKCE_CODE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const CALLBACK_STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{16,128}$/;

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
let pollingPromise: Promise<NativeAuthPollingResult> | null = null;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

export async function getNativeSessionToken(): Promise<string | null> {
  await ensureInitialized();
  return state.sessionToken;
}

export async function getNativeDeviceId(): Promise<string> {
  const storedDeviceId = await readStoreValue<string>(DEVICE_ID_KEY);
  if (storedDeviceId && DEVICE_ID_PATTERN.test(storedDeviceId)) {
    return storedDeviceId;
  }

  const nextDeviceId = crypto.randomUUID();
  await writeStoreValue(DEVICE_ID_KEY, nextDeviceId);
  return nextDeviceId;
}

// ── Auth flow ──────────────────────────────────────────────────────────────────

export async function startNativeAuthRequest(): Promise<string> {
  const deviceId = await getNativeDeviceId();
  const stateToken = randomBase64Url(18);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await createCodeChallenge(codeVerifier);

  const pendingAuth: PendingNativeAuth = {
    state: stateToken,
    codeVerifier,
    deviceId,
    createdAt: Date.now(),
  };
  await writeStoreValue(PENDING_AUTH_KEY, pendingAuth);

  const url = new URL(buildWebUrl("/native/auth/start"));
  url.searchParams.set("device_id", deviceId);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("state", stateToken);
  url.searchParams.set("surface", "desktop");
  url.searchParams.set("redirect_uri", buildWebUrl("/native/auth/complete"));
  return url.toString();
}

async function pollNativeCodeByState(params: {
  state: string;
  deviceId: string;
  codeVerifier: string;
}): Promise<ExchangeResponse | null> {
  const response = await fetch(`${convexSiteBaseUrl}/api/native/auth/poll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state: params.state,
      deviceId: params.deviceId,
      codeVerifier: params.codeVerifier,
    }),
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    if (response.status >= 500) {
      return null;
    }
    throw new Error("Native login polling failed");
  }

  const data = (await response.json()) as Partial<ExchangeResponse>;
  if (!(data.sessionToken && typeof data.sessionToken === "string")) {
    throw new Error("Native login polling response is invalid");
  }

  return {
    sessionToken: data.sessionToken,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : Date.now(),
  };
}

export function startNativeAuthPolling(): Promise<NativeAuthPollingResult> {
  if (pollingPromise) {
    return pollingPromise;
  }

  pollingPromise = (async () => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < DESKTOP_PENDING_MAX_AGE_MS) {
      const pending = await readStoreValue<PendingNativeAuth>(PENDING_AUTH_KEY);
      if (!pending) {
        return "cancelled";
      }

      if (getSnapshot().sessionToken) {
        await writeStoreValue(PENDING_AUTH_KEY, null);
        return "authenticated";
      }

      const isExpired =
        Date.now() - pending.createdAt > DESKTOP_PENDING_MAX_AGE_MS;
      if (isExpired) {
        await writeStoreValue(PENDING_AUTH_KEY, null);
        return "timeout";
      }

      if (
        !(
          PKCE_CODE_PATTERN.test(pending.codeVerifier) &&
          DEVICE_ID_PATTERN.test(pending.deviceId) &&
          CALLBACK_STATE_PATTERN.test(pending.state)
        )
      ) {
        await writeStoreValue(PENDING_AUTH_KEY, null);
        return "cancelled";
      }

      try {
        const exchangeResult = await pollNativeCodeByState({
          state: pending.state,
          deviceId: pending.deviceId,
          codeVerifier: pending.codeVerifier,
        });

        if (exchangeResult) {
          await writeStoreValue(PENDING_AUTH_KEY, null);
          await setSessionToken(exchangeResult.sessionToken);
          return "authenticated";
        }
      } catch {
        await writeStoreValue(PENDING_AUTH_KEY, null);
        return "cancelled";
      }

      await sleep(DESKTOP_AUTH_POLL_INTERVAL_MS);
    }

    await writeStoreValue(PENDING_AUTH_KEY, null);
    return "timeout";
  })().finally(() => {
    pollingPromise = null;
  });

  return pollingPromise;
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
