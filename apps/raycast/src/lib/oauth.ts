import { environment, LocalStorage, OAuth } from "@raycast/api";
import {
  type AuthDiscovery,
  createConnectAuthorizeUrl,
  disconnectConnectGrant,
  discoverAuthServer,
  requestConnectTokens,
  WORKOS_CONNECT_SCOPE,
} from "teak-sdk";
import { getApiBaseUrl } from "./constants";

export class TeakDiscoveryError extends Error {
  constructor() {
    super("Unable to reach Teak. Check your connection and retry.");
    this.name = "TeakDiscoveryError";
  }
}

class TeakSessionExpiredError extends Error {}
class TeakRefreshRevokedError extends TeakSessionExpiredError {}
class TeakLocalSignOutError extends Error {}
class TeakRefreshClientRejectedError extends Error {}
const reconnectAfterSignOut =
  "Sign Out before reconnecting, then wait five minutes for disconnect to finish.";
export class TeakSignOutRequiredError extends Error {
  constructor() {
    super(reconnectAfterSignOut);
  }
}

interface Provider {
  auth: AuthDiscovery;
  client: OAuth.PKCEClient;
}
const providers = new Map<string, Provider>();
const discovery = (forceRefresh = false) =>
  discoverAuthServer(getApiBaseUrl(), { forceRefresh });
const providerKey = (auth: AuthDiscovery) =>
  `${getApiBaseUrl()}|${auth.issuer}|${auth.clients.raycast}`;

interface SavedProvider {
  apiBaseUrl: string;
  clientId: string;
  issuer: string;
  providerId: string;
}
const registryPrefix = () =>
  `teak.oauth.provider:${encodeURIComponent(getApiBaseUrl())}:`;
const nativeClient = (providerId: string) =>
  new OAuth.PKCEClient({
    redirectMethod: OAuth.RedirectMethod.Web,
    providerName: "Teak",
    providerId,
    providerIcon: "icon.png",
    description: "Connect your Teak account to save and search cards.",
  });
function savedProvider(auth: AuthDiscovery): SavedProvider {
  return {
    apiBaseUrl: getApiBaseUrl(),
    providerId: `teak:${providerKey(auth)}`,
    issuer: auth.issuer,
    clientId: auth.clients.raycast,
  };
}
function validateSavedProvider(raw: unknown): SavedProvider {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("apiBaseUrl" in raw) ||
    raw.apiBaseUrl !== getApiBaseUrl() ||
    !("providerId" in raw) ||
    typeof raw.providerId !== "string" ||
    !("issuer" in raw) ||
    typeof raw.issuer !== "string" ||
    !("clientId" in raw) ||
    typeof raw.clientId !== "string" ||
    !raw.clientId
  ) {
    throw new Error("Invalid saved Teak connection");
  }
  const record = {
    apiBaseUrl: raw.apiBaseUrl,
    providerId: raw.providerId,
    issuer: raw.issuer,
    clientId: raw.clientId,
  };
  const issuer = new URL(raw.issuer);
  if (
    raw.providerId !== `teak:${raw.apiBaseUrl}|${raw.issuer}|${raw.clientId}` ||
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  ) {
    throw new Error("Invalid saved Teak connection");
  }
  // The Keychain namespace is derived from the saved issuer and client, so
  // tampering with either cannot reach another connection's tokens. A
  // connection from a replaced client registration stays clearable here;
  // refresh only ever uses the currently discovered issuer and client.
  return record;
}
async function rememberProvider(auth: AuthDiscovery) {
  const record = savedProvider(auth);
  // AuthKit Connect disconnects through Teak, never an inferred provider URL.
  await LocalStorage.setItem(
    `${registryPrefix()}${record.providerId}`,
    JSON.stringify(record),
  );
}
async function getProvider(forceRefresh = false): Promise<Provider> {
  let auth: AuthDiscovery;
  try {
    auth = await discovery(forceRefresh);
  } catch {
    throw new TeakDiscoveryError();
  }
  const key = providerKey(auth);
  const cached = providers.get(key);
  if (cached) {
    cached.auth = auth;
    await rememberProvider(auth);
    return cached;
  }
  const provider = {
    auth,
    client: nativeClient(savedProvider(auth).providerId),
  };
  await rememberProvider(auth);
  providers.set(key, provider);
  return provider;
}

async function refetchAfterFailure() {
  try {
    await discovery(true);
  } catch {
    // Keep the original failure; failed discovery never selects a fallback.
  }
}

async function exchange(
  provider: Provider,
  grant: Record<string, string>,
): Promise<string> {
  const result = await requestConnectTokens(provider.auth, {
    clientId: provider.auth.clients.raycast,
    grant,
    local: environment.isDevelopment,
  });
  if (result.ok) {
    const { accessToken, expiresIn, refreshToken } = result.tokens;
    await provider.client.setTokens({ accessToken, expiresIn, refreshToken });
    return accessToken;
  }
  const { reason, status } = result;
  if (reason === "failed" && (status === 429 || status >= 500)) {
    throw new TeakDiscoveryError();
  }
  if (reason === "invalid_response") {
    throw new Error("Invalid Teak sign-in response.");
  }
  // Uncertain refresh failures must not trigger browser auth over saved tokens.
  if (grant.grant_type !== "refresh_token") {
    throw new TeakSessionExpiredError("Teak sign-in expired. Sign in again.");
  }
  if (reason === "refresh_token_rejected") {
    throw new TeakRefreshRevokedError("Teak refresh credential was revoked.");
  }
  if (reason === "client_rejected") {
    // The client was rejected, not necessarily its remote grant revoked.
    // Only explicit Sign Out may forget this local credential.
    throw new TeakRefreshClientRejectedError("Teak client was rejected.");
  }
  throw new Error("Teak token request was rejected. Try again.");
}

let inFlightAuthorize: Promise<string> | null = null;
let inFlightStoredToken: Promise<string | null> | null = null;
export type SignOutResult = "disconnected" | "local-only";
let inFlightSignOut: Promise<SignOutResult> | null = null;
let inFlightReauthorize: Promise<string> | null = null;

export function authorizeTeak(): Promise<string> {
  if (inFlightSignOut) {
    return Promise.reject(
      new Error("Teak sign-out is in progress. Try again."),
    );
  }
  if (inFlightReauthorize) return inFlightReauthorize;
  if (!inFlightAuthorize) {
    inFlightAuthorize = authorize().finally(() => {
      inFlightAuthorize = null;
    });
  }
  return inFlightAuthorize;
}

async function authorize(): Promise<string> {
  // The same refresh guard is used by background and interactive commands.
  const stored = await getStoredTeakAccessToken();
  if (stored) {
    return stored;
  }
  return authorizeProvider(await getProvider());
}

async function authorizeProvider(provider: Provider): Promise<string> {
  try {
    const request = await provider.client.authorizationRequest({
      endpoint: provider.auth.authorizationEndpoint,
      clientId: provider.auth.clients.raycast,
      scope: WORKOS_CONNECT_SCOPE,
    });
    const url = createConnectAuthorizeUrl(provider.auth, {
      clientId: provider.auth.clients.raycast,
      codeChallenge: request.codeChallenge,
      redirectUri: request.redirectURI,
      state: request.state,
    });
    const { authorizationCode } = await provider.client.authorize({
      url: url.href,
    });
    return await exchange(provider, {
      grant_type: "authorization_code",
      code: authorizationCode,
      code_verifier: request.codeVerifier,
      redirect_uri: request.redirectURI,
    });
  } catch (error) {
    await refetchAfterFailure();
    throw error;
  }
}

export function reauthorizeTeak(): Promise<string> {
  if (inFlightSignOut) {
    return Promise.reject(
      new Error("Teak sign-out is in progress. Try again."),
    );
  }
  if (!inFlightReauthorize) {
    inFlightReauthorize = (async () => {
      await Promise.allSettled([inFlightAuthorize, inFlightStoredToken]);
      const provider = await getProvider(true);
      const tokens = await provider.client.getTokens();
      if (tokens?.refreshToken) {
        const renewed = exchange(provider, {
          grant_type: "refresh_token",
          // Runtime credential from secure storage, not a hard-coded token.
          // nosemgrep: codacy.yaml.security.hard-coded-tokens
          refresh_token: tokens.refreshToken,
        });
        // Background readers join this rotation instead of replaying the old
        // refresh token while reauthorization is in flight.
        inFlightStoredToken = renewed;
        try {
          return await renewed;
        } finally {
          if (inFlightStoredToken === renewed) inFlightStoredToken = null;
        }
      }
      if (tokens) {
        throw new TeakSignOutRequiredError();
      }
      return authorizeProvider(provider);
    })().finally(() => {
      inFlightReauthorize = null;
    });
  }
  return inFlightReauthorize;
}

export function signOutTeak(): Promise<SignOutResult> {
  if (!inFlightSignOut) {
    inFlightSignOut = revokeStoredSession().finally(() => {
      inFlightSignOut = null;
    });
  }
  return inFlightSignOut;
}

async function revokeStoredSession(): Promise<SignOutResult> {
  await Promise.allSettled([
    inFlightAuthorize,
    inFlightStoredToken,
    inFlightReauthorize,
  ]);
  await getProvider();
  const saved = await LocalStorage.allItems();
  const records = new Map<string, SavedProvider>();
  const entries = Object.entries(saved).filter(([key]) =>
    key.startsWith(registryPrefix()),
  );
  if (entries.length > 64) {
    throw new Error(
      "Too many saved Teak connections; Sign Out could not finish.",
    );
  }
  let invalidMetadata = false;
  let localOnly = false;
  for (const [key, value] of entries) {
    try {
      if (typeof value !== "string" || value.length > 8192) {
        throw new Error("Invalid saved Teak connection");
      }
      const record = validateSavedProvider(JSON.parse(value));
      if (key !== `${registryPrefix()}${record.providerId}`) {
        throw new Error("Saved connection namespace mismatch");
      }
      records.set(record.providerId, record);
    } catch {
      // Only discard the corrupt metadata. Never trust its namespace enough
      // to read/delete Keychain credentials or contact a remote server.
      await LocalStorage.removeItem(key);
      invalidMetadata = true;
    }
  }
  for (const record of records.values()) {
    const client = nativeClient(record.providerId);
    const tokens = await client.getTokens();
    if (tokens) {
      try {
        const refreshAccessToken = async () => {
          const provider = await getProvider(true);
          if (
            providerKey(provider.auth) !==
            `${record.apiBaseUrl}|${record.issuer}|${record.clientId}`
          ) {
            // This exact historical namespace is trusted, but refreshing it via
            // the new provider would disclose credentials. Explicit Sign Out
            // may clear it locally without claiming provider revocation.
            throw new TeakLocalSignOutError();
          }
          if (!tokens.refreshToken) {
            // No refresh credential can recover this rejected or absent access
            // token. Explicit Sign Out may forget this Mac, not the remote grant.
            throw new TeakLocalSignOutError();
          }
          // exchange stores rotated tokens before the retry. Sign-out blocks
          // new readers and has drained all in-flight refreshes.
          return exchange(provider, {
            grant_type: "refresh_token",
            // Runtime credential from secure storage, not a hard-coded token.
            // nosemgrep: codacy.yaml.security.hard-coded-tokens
            refresh_token: tokens.refreshToken,
          });
        };
        const local = environment.isDevelopment;
        // Try an old token first so a completed disconnect can recover without
        // refreshing a grant the provider has already revoked.
        const result = tokens.accessToken
          ? await disconnectConnectGrant(getApiBaseUrl(), tokens.accessToken, {
              local,
              refreshAccessToken,
            })
          : await disconnectConnectGrant(
              getApiBaseUrl(),
              await refreshAccessToken(),
              { local },
            );
        if (result !== "disconnected") {
          throw new Error("Disconnect failed");
        }
      } catch (error) {
        // A dead grant, rejected client or unusable local connection permits
        // explicit local clearing without claiming remote revocation;
        // uncertain failures retain their credentials.
        if (
          !(
            error instanceof TeakRefreshRevokedError ||
            error instanceof TeakLocalSignOutError ||
            error instanceof TeakRefreshClientRejectedError
          )
        ) {
          throw new Error(
            "Your credentials are still saved. Check your connection and try Sign Out again.",
          );
        }
        localOnly = true;
      }
    }
    await client.removeTokens();
    await LocalStorage.removeItem(`${registryPrefix()}${record.providerId}`);
  }
  if (invalidMetadata) {
    throw new Error(
      "Invalid connection metadata was removed. Known local credentials were cleared; unknown credentials were kept.",
    );
  }
  return localOnly ? "local-only" : "disconnected";
}

export async function hasStoredTeakSession(): Promise<boolean> {
  if (inFlightSignOut) {
    return false;
  }
  const provider = await getProvider();
  // Even an unusable saved credential needs an explicit Sign Out action.
  return Boolean(await provider.client.getTokens());
}

export function getStoredTeakAccessToken(): Promise<string | null> {
  if (inFlightSignOut) {
    return Promise.resolve(null);
  }
  if (inFlightReauthorize) return inFlightReauthorize;
  if (!inFlightStoredToken) {
    inFlightStoredToken = resolveStoredTeakAccessToken().finally(() => {
      inFlightStoredToken = null;
    });
  }
  return inFlightStoredToken;
}

async function resolveStoredTeakAccessToken(): Promise<string | null> {
  const provider = await getProvider();
  const tokens = await provider.client.getTokens();
  if (!tokens) {
    return null;
  }
  if (tokens.accessToken && !tokens.isExpired()) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new TeakSignOutRequiredError();
  }
  try {
    return await exchange(provider, {
      grant_type: "refresh_token",
      // Runtime credential from secure storage, not a hard-coded token.
      // nosemgrep: codacy.yaml.security.hard-coded-tokens
      refresh_token: tokens.refreshToken,
    });
  } catch (error) {
    await refetchAfterFailure();
    if (!tokens.accessToken && error instanceof TeakRefreshRevokedError) {
      throw new TeakSignOutRequiredError();
    }
    if (error instanceof TeakSessionExpiredError) {
      return null;
    }
    throw new TeakDiscoveryError();
  }
}
