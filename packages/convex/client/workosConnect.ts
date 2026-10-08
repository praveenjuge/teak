import { readResponseTextWithinLimit } from "../shared/boundedResponse";
import { type AuthDiscovery, validateOAuthUrl } from "./authDiscovery";

// WorkOS Connect (OAuth 2.0 authorization code + PKCE) protocol steps shared by
// Teak's public clients. Storage, locking, callbacks and copy stay per client.
// `local` permits loopback http endpoints for local development, as in
// validateOAuthUrl; discovery decides which loopback servers are approved.

export const WORKOS_CONNECT_SCOPE = "openid profile email offline_access";

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TOKEN_LIFETIME_SECONDS = 365 * 24 * 3600;
const REQUEST_TIMEOUT_MS = 10_000;

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/, "");
};

export const randomBase64Url = (byteLength: number): string =>
  base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));

// RFC 7636 S256: BASE64URL(SHA256(ASCII(code_verifier))).
export const createPkceChallenge = async (verifier: string): Promise<string> =>
  base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    )
  );

const apiResource = (auth: AuthDiscovery) =>
  new URL("/api", auth.resource).href;

export const createConnectAuthorizeUrl = (
  auth: AuthDiscovery,
  params: {
    clientId: string;
    codeChallenge: string;
    redirectUri: string;
    state: string;
  }
): URL => {
  const url = new URL(auth.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("resource", apiResource(auth));
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", WORKOS_CONNECT_SCOPE);
  url.searchParams.set("state", params.state);
  return url;
};

const send = (url: string, init: RequestInit, local: boolean) =>
  fetch(validateOAuthUrl(url, local).href, {
    ...init,
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

const readObject = async (
  response: Response
): Promise<Record<string, unknown> | null> => {
  const text = await readResponseTextWithinLimit(response, MAX_RESPONSE_BYTES);
  if (text === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export interface ConnectTokens {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
}

// refresh_token_rejected: WorkOS proved the refresh credential is dead.
// rejected: any other 400/401. failed: any other non-2xx response.
// invalid_response: a 2xx response without a usable token set.
export type ConnectTokenResult =
  | { ok: true; tokens: ConnectTokens }
  | {
      ok: false;
      reason:
        | "refresh_token_rejected"
        | "rejected"
        | "failed"
        | "invalid_response";
      status: number;
    };

export const requestConnectTokens = async (
  auth: AuthDiscovery,
  options: {
    clientId: string;
    grant: Record<string, string>;
    local?: boolean;
  }
): Promise<ConnectTokenResult> => {
  const response = await send(
    auth.tokenEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...options.grant,
        client_id: options.clientId,
        resource: apiResource(auth),
      }),
    },
    options.local ?? false
  );
  const payload = await readObject(response);
  const { status } = response;
  if (!response.ok) {
    if (status !== 400 && status !== 401) {
      return { ok: false, reason: "failed", status };
    }
    const refreshTokenRejected =
      options.grant.grant_type === "refresh_token" &&
      (payload?.error === "invalid_grant" ||
        payload?.error === "invalid_refresh_token" ||
        payload?.code === "invalid_refresh_token");
    return {
      ok: false,
      reason: refreshTokenRejected ? "refresh_token_rejected" : "rejected",
      status,
    };
  }
  const expiresIn = payload?.expires_in;
  if (
    typeof payload?.access_token !== "string" ||
    !payload.access_token ||
    typeof payload.refresh_token !== "string" ||
    !payload.refresh_token ||
    typeof expiresIn !== "number" ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > MAX_TOKEN_LIFETIME_SECONDS
  ) {
    return { ok: false, reason: "invalid_response", status };
  }
  return {
    ok: true,
    tokens: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: Date.now() + expiresIn * 1000,
    },
  };
};

const apiEndpoint = (apiUrl: string, path: string, local: boolean) => {
  let base = validateOAuthUrl(apiUrl, local).href;
  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return `${base.replace(/\/v1$/, "")}${path}`;
};

// Revokes this app's grant for the signed-in user. Teak confirms only with 204.
// On one 401, refreshAccessToken may return a renewed access token to retry once
// (persist any rotated refresh token before returning) or null to stop.
export const disconnectConnectGrant = async (
  apiUrl: string,
  accessToken: string,
  options: {
    local?: boolean;
    refreshAccessToken?: () => Promise<string | null>;
  } = {}
): Promise<"disconnected" | "unconfirmed" | "refresh_rejected"> => {
  const local = options.local ?? false;
  const endpoint = apiEndpoint(apiUrl, "/v1/oauth/disconnect", local);
  const disconnect = (token: string) =>
    send(
      endpoint,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      local
    );
  let response = await disconnect(accessToken);
  if (response.status === 401 && options.refreshAccessToken) {
    const renewed = await options.refreshAccessToken();
    if (renewed === null) {
      return "refresh_rejected";
    }
    response = await disconnect(renewed);
  }
  return response.status === 204 ? "disconnected" : "unconfirmed";
};

// Returns the Teak account ID that owns accessToken, or null when Teak does not
// confirm one. Clients bind saved credentials to this owner.
export const fetchConnectOwnerId = async (
  apiUrl: string,
  accessToken: string,
  options: { local?: boolean } = {}
): Promise<string | null> => {
  const local = options.local ?? false;
  const response = await send(
    apiEndpoint(apiUrl, "/v1/me", local),
    { headers: { Authorization: `Bearer ${accessToken}` } },
    local
  );
  if (!response.ok) {
    return null;
  }
  const data = (await readObject(response))?.data;
  const id =
    data && typeof data === "object" && "id" in data ? data.id : undefined;
  return typeof id === "string" && id ? id : null;
};
