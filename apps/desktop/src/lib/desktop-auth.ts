import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { readStoreValue, writeStoreValue } from "@/lib/store";
import { buildWebUrl } from "@/lib/web-urls";

const SESSION_TOKEN_KEY = "auth.sessionToken";
const DEVICE_ID_KEY = "auth.deviceId";
const PENDING_AUTH_KEY = "auth.pendingDesktopFlow";
const DESKTOP_PENDING_MAX_AGE_MS = 10 * 60 * 1000;
const DESKTOP_AUTH_POLL_INTERVAL_MS = 2000;
const JWT_EXPIRY_SKEW_MS = 10_000;

type DesktopAuthState = {
  isInitialized: boolean;
  sessionToken: string | null;
};

type PendingDesktopAuth = {
  state: string;
  codeVerifier: string;
  deviceId: string;
  createdAt: number;
};

type CachedJwt = {
  token: string;
  expiresAt: number;
};

type ExchangeResponse = {
  sessionToken: string;
  expiresAt: number;
};

export type DesktopAuthPollingResult =
  | "authenticated"
  | "timeout"
  | "cancelled";

const PKCE_CODE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const CALLBACK_STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{16,128}$/;

const convexSiteUrl = import.meta.env.VITE_PUBLIC_CONVEX_SITE_URL;

if (!convexSiteUrl) {
  throw new Error("Missing VITE_PUBLIC_CONVEX_SITE_URL in desktop environment");
}

let state: DesktopAuthState = {
  isInitialized: false,
  sessionToken: null,
};

let cachedJwt: CachedJwt | null = null;
let initializationPromise: Promise<void> | null = null;
let pollingPromise: Promise<DesktopAuthPollingResult> | null = null;
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

function getSnapshot(): DesktopAuthState {
  return state;
}

function setState(nextState: DesktopAuthState) {
  state = nextState;
  notifyListeners();
}

function normalizeConvexSiteUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error("Invalid VITE_PUBLIC_CONVEX_SITE_URL");
  }
}

const convexSiteBaseUrl = normalizeConvexSiteUrl(convexSiteUrl);

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

function randomUuid(): string {
  return crypto.randomUUID();
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

async function setSessionToken(sessionToken: string): Promise<void> {
  await writeStoreValue(SESSION_TOKEN_KEY, sessionToken);
  cachedJwt = null;
  setState({
    isInitialized: true,
    sessionToken,
  });
}

export async function clearDesktopSessionToken(): Promise<void> {
  await writeStoreValue(SESSION_TOKEN_KEY, null);
  cachedJwt = null;
  setState({
    isInitialized: true,
    sessionToken: null,
  });
}

export async function getDesktopSessionToken(): Promise<string | null> {
  await ensureInitialized();
  return state.sessionToken;
}

export async function getDesktopDeviceId(): Promise<string> {
  const storedDeviceId = await readStoreValue<string>(DEVICE_ID_KEY);
  if (storedDeviceId && DEVICE_ID_PATTERN.test(storedDeviceId)) {
    return storedDeviceId;
  }

  const nextDeviceId = randomUuid();
  await writeStoreValue(DEVICE_ID_KEY, nextDeviceId);
  return nextDeviceId;
}

export async function startDesktopAuthRequest(): Promise<string> {
  const deviceId = await getDesktopDeviceId();
  const stateToken = randomBase64Url(18);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await createCodeChallenge(codeVerifier);

  const pendingAuth: PendingDesktopAuth = {
    state: stateToken,
    codeVerifier,
    deviceId,
    createdAt: Date.now(),
  };
  await writeStoreValue(PENDING_AUTH_KEY, pendingAuth);

  const url = new URL(buildWebUrl("/desktop/auth/start"));
  url.searchParams.set("device_id", deviceId);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("state", stateToken);
  url.searchParams.set("redirect_uri", buildWebUrl("/desktop/auth/complete"));
  return url.toString();
}

async function pollDesktopCodeByState(params: {
  state: string;
  deviceId: string;
  codeVerifier: string;
}): Promise<ExchangeResponse | null> {
  const response = await fetch(`${convexSiteBaseUrl}/api/desktop/auth/poll`, {
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
    throw new Error("Desktop login polling failed");
  }

  const data = (await response.json()) as Partial<ExchangeResponse>;
  if (!(data.sessionToken && typeof data.sessionToken === "string")) {
    throw new Error("Desktop login polling response is invalid");
  }

  return {
    sessionToken: data.sessionToken,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : Date.now(),
  };
}

export function startDesktopAuthPolling(): Promise<DesktopAuthPollingResult> {
  if (pollingPromise) {
    return pollingPromise;
  }

  pollingPromise = (async () => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < DESKTOP_PENDING_MAX_AGE_MS) {
      const pending =
        await readStoreValue<PendingDesktopAuth>(PENDING_AUTH_KEY);
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
        const exchangeResult = await pollDesktopCodeByState({
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
    await clearDesktopSessionToken();
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

export async function logoutDesktopSession(): Promise<void> {
  const sessionToken = await getDesktopSessionToken();

  if (sessionToken) {
    await fetch(`${convexSiteBaseUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    }).catch(() => undefined);
  }

  await clearDesktopSessionToken();
  await writeStoreValue(PENDING_AUTH_KEY, null);
}

export function useDesktopConvexAuth() {
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
