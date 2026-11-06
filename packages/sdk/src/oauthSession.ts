import {
  type AuthDiscovery,
  discoverAuthServer,
  type OAuthSurface,
} from "./authDiscovery";
import { TeakApiError, type TeakApiErrorCode } from "./errors";
import type { TokenProvider } from "./index";
import {
  type ConnectTokenResult,
  createConnectAuthorizeUrl,
  createPkceChallenge,
  disconnectConnectGrant,
  fetchConnectOwnerId,
  randomBase64Url,
  requestConnectTokens,
} from "./workosConnect";

/** The deployment, issuer and OAuth client a sign-in was issued for. */
export interface CredentialBinding {
  clientId: string;
  issuer: string;
  origin: string;
}

/**
 * Whether a saved sign-in came from WorkOS (bound, with a WorkOS client),
 * not from the sign-in Teak had before.
 * @deprecated `createOAuthSession` checks this; it stays for older callers.
 */
export const isWorkosCredential = (
  saved: Partial<CredentialBinding> | undefined
): saved is CredentialBinding =>
  Boolean(
    saved?.origin && saved.issuer && saved.clientId?.startsWith("client_")
  );

/**
 * Whether a saved sign-in was issued for this deployment, issuer and client.
 * @deprecated `createOAuthSession` checks this; it stays for older callers.
 */
export const matchesBinding = (
  saved: Partial<CredentialBinding> | undefined,
  current: CredentialBinding
): boolean =>
  saved?.origin === current.origin &&
  saved.issuer === current.issuer &&
  saved.clientId === current.clientId;

/**
 * Whether a token response proved the refresh token dead.
 * @deprecated `createOAuthSession` handles a dead refresh token.
 */
export const isRefreshTokenDead = (result: ConnectTokenResult): boolean =>
  !result.ok && result.reason === "refresh_token_rejected";

/**
 * Runs a refresh and saves what it returns before anything else: a refresh
 * rotates the refresh token, so losing the replacement signs the user out.
 * @deprecated `createOAuthSession` saves every rotation itself.
 */
export const refreshAndSave = async <T>(
  refresh: () => Promise<T>,
  save: (renewed: NonNullable<T>) => unknown
): Promise<T> => {
  const renewed = await refresh();
  if (renewed !== null && renewed !== undefined) {
    await save(renewed);
  }
  return renewed;
};

/**
 * A saved access token is used until it has this long left; then it is
 * refreshed first, so it can't expire on the way to Teak.
 */
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000;

/** A sign-in's tokens and what they were issued for. */
export interface OAuthCredentials {
  accessToken: string;
  /** The OAuth client the tokens were issued to. */
  clientId?: string;
  /** When the access token expires, in epoch milliseconds. */
  expiresAt: number;
  issuer?: string;
  /** The Teak deployment the tokens were issued for (the session's `apiUrl`). */
  origin?: string;
  /** The Teak account the sign-in verified. */
  ownerId?: string;
  refreshToken: string;
}

/** Where a client keeps its sign-in; `null` clears it. */
export interface OAuthCredentialStore {
  read: () => OAuthCredentials | null | Promise<OAuthCredentials | null>;
  write: (credentials: OAuthCredentials | null) => unknown;
}

export interface OAuthSessionOptions {
  /** The Teak API the tokens are for, and the credential's binding. */
  apiUrl: string;
  /** Where to read the OAuth discovery document; defaults to `apiUrl`. */
  authSiteUrl?: string;
  /**
   * The issuer this client was told to use (such as `TEAK_AUTH_URL`);
   * a deployment naming another one is refused.
   */
  expectedIssuer?: string;
  /** A loopback issuer a local development stack may name. */
  localIssuer?: string;
  /**
   * Runs credential work one at a time. A client whose processes share the
   * store passes a lock that holds across them; a refresh rotates the
   * refresh token, so two at once would sign the loser out.
   */
  lock?: <T>(work: () => Promise<T>) => Promise<T>;
  store: OAuthCredentialStore;
  surface: OAuthSurface;
}

/** The browser hand-off of a sign-in: open `url`, return the redirect it ends on. */
export type OAuthAuthorize = (url: URL) => Promise<string | URL | null>;

export type OAuthSignOutResult = "disconnected" | "signed-out-here";

const trimSlashes = (value: string) => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(0, end);
};

const sameUrl = (a: string, b: string) => trimSlashes(a) === trimSlashes(b);

/**
 * Why a sign-in step stopped, for each client to say in its own words:
 * - `cancelled`: the browser hand-off ended without a sign-in.
 * - `not_verified`: the redirect didn't match the request (state or code).
 * - `provider_changed`: the client registration changed during sign-in.
 * - `signed_out`: sign-out ran while the sign-in was finishing.
 * - `sign_out_first`: a saved sign-in of unknown account must be signed out
 *   (and its disconnect finished) before another.
 * - `previous_kept`: the sign-in it replaces couldn't be disconnected.
 * - `account_unverified`: Teak didn't confirm the signed-in account.
 * - `account_changed`: the saved sign-in is for another account.
 * - `token_rejected`: the sign-in server refused or failed a token request.
 * - `unexpected_issuer`: the deployment names another sign-in server than
 *   the one the client was told to use.
 */
export type OAuthFailure =
  | "account_changed"
  | "account_unverified"
  | "cancelled"
  | "not_verified"
  | "previous_kept"
  | "provider_changed"
  | "sign_out_first"
  | "signed_out"
  | "token_rejected"
  | "unexpected_issuer";

const MESSAGES: Record<OAuthFailure, string> = {
  account_changed:
    "The signed-in account changed. Sign in to the original account to finish.",
  account_unverified: "Could not verify your account. Sign in again.",
  cancelled: "Sign-in was canceled.",
  not_verified: "Sign-in could not be verified. Sign in again.",
  previous_kept:
    "Your earlier sign-in is still saved. Sign out before signing in again.",
  provider_changed: "The sign-in server changed during sign-in. Sign in again.",
  sign_out_first:
    "Sign out before signing in again, then wait 15 minutes for the disconnect to finish.",
  signed_out: "Sign-in was cancelled by signing out. Sign in again.",
  token_rejected: "Could not complete Teak sign-in.",
  unexpected_issuer:
    "The deployment names another sign-in server than the one this client was told to use.",
};

// Sign in again (auth), the state moved underneath (conflict), another
// account (forbidden), or the client is pointed at the wrong server (config).
const CODES: Record<OAuthFailure, TeakApiErrorCode> = {
  account_changed: "FORBIDDEN",
  account_unverified: "UNAUTHORIZED",
  cancelled: "AUTH_REQUIRED",
  not_verified: "UNAUTHORIZED",
  previous_kept: "CONFLICT",
  provider_changed: "CONFLICT",
  sign_out_first: "CONFLICT",
  signed_out: "CONFLICT",
  token_rejected: "UNAUTHORIZED",
  unexpected_issuer: "CONFIG_ERROR",
};

/** A sign-in or token step that stopped; `reason` says which. */
export class OAuthSessionError extends TeakApiError {
  reason: OAuthFailure;

  constructor(reason: OAuthFailure, init?: { status?: number }) {
    super(CODES[reason], MESSAGES[reason], init);
    this.name = "OAuthSessionError";
    this.reason = reason;
  }
}

const signInFailed = (status?: number) =>
  new OAuthSessionError("token_rejected", { status });

/**
 * One OAuth sign-in for a Teak client: the token provider that refreshes
 * it, sign-in and sign-out. The client supplies where tokens are kept, a
 * lock and the browser hand-off; the lifecycle is the same everywhere.
 */
export const createOAuthSession = (options: OAuthSessionOptions) => {
  const lock =
    options.lock ?? (<T>(work: () => Promise<T>): Promise<T> => work());
  const { apiUrl, store, surface } = options;
  // Bumped by sign-out, so work that started before it saves nothing.
  let signOutEpoch = 0;
  // Discovery has approved every endpoint used after it, loopback ones
  // included only for a local deployment or the named local issuer.
  const local = true;

  const discover = async (forceRefresh = false): Promise<AuthDiscovery> => {
    const auth = await discoverAuthServer(options.authSiteUrl ?? apiUrl, {
      forceRefresh,
      ...(options.localIssuer ? { localIssuer: options.localIssuer } : {}),
    });
    if (
      options.expectedIssuer &&
      !sameUrl(options.expectedIssuer, auth.issuer)
    ) {
      throw new OAuthSessionError("unexpected_issuer");
    }
    return auth;
  };
  // After a failure, discovery is read again so a moved client registration
  // is picked up by the next attempt; that read failing changes nothing.
  const rediscover = () =>
    discover(true).then(
      () => undefined,
      () => undefined
    );

  const clientId = (auth: AuthDiscovery) => auth.clients[surface];
  const matches = (credentials: OAuthCredentials, auth: AuthDiscovery) =>
    matchesBinding(credentials, {
      origin: apiUrl,
      issuer: auth.issuer,
      clientId: clientId(auth),
    });
  // Issued for this deployment (and the issuer the client was told to use),
  // so a fresh token can be sent without asking discovery first.
  const boundHere = (credentials: OAuthCredentials) =>
    isWorkosCredential(credentials) &&
    credentials.origin === apiUrl &&
    (!options.expectedIssuer ||
      sameUrl(options.expectedIssuer, credentials.issuer ?? ""));
  const fresh = (credentials: OAuthCredentials) =>
    credentials.expiresAt - Date.now() >= ACCESS_TOKEN_REFRESH_MARGIN_MS;

  /** Tokens for a grant, or null when the refresh token is dead. */
  const grant = async (
    auth: AuthDiscovery,
    body: Record<string, string>
  ): Promise<OAuthCredentials | null> => {
    const result = await requestConnectTokens(auth, {
      clientId: clientId(auth),
      grant: body,
      local,
    });
    if (result.ok) {
      const { accessToken, expiresAt, refreshToken } = result.tokens;
      return {
        accessToken,
        expiresAt,
        refreshToken,
        origin: apiUrl,
        issuer: auth.issuer,
        clientId: clientId(auth),
      };
    }
    if (isRefreshTokenDead(result)) {
      return null;
    }
    throw signInFailed(result.status);
  };

  // A refresh rotates the refresh token and invalidates the one sent, so the
  // replacement is saved before anything else can lose it.
  const refresh = async (
    credentials: OAuthCredentials,
    auth: AuthDiscovery
  ): Promise<OAuthCredentials | null> => {
    let renewed: OAuthCredentials | null;
    try {
      renewed = await grant(auth, {
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
      });
    } catch (error) {
      await rediscover();
      throw error;
    }
    if (!renewed) {
      await store.write(null);
      await rediscover();
      return null;
    }
    const saved = { ...renewed, ownerId: credentials.ownerId };
    await store.write(saved);
    return saved;
  };

  // The access tokens this session handed out, with the refresh token each
  // came with: a 401 for one is a reason to refresh only while the saved
  // tokens are still those.
  const issued = new Map<string, string>();
  const hand = (credentials: OAuthCredentials) => {
    issued.set(credentials.accessToken, credentials.refreshToken);
    if (issued.size > 2) {
      issued.delete(issued.keys().next().value as string);
    }
    return credentials;
  };

  const revoke = async (
    credentials: OAuthCredentials,
    refreshSaved: boolean
  ): Promise<OAuthSignOutResult> => {
    // A sign-in from before WorkOS has no grant to disconnect.
    if (!isWorkosCredential(credentials)) {
      return "disconnected";
    }
    if (credentials.origin !== apiUrl) {
      throw new Error("The saved sign-in belongs to another deployment.");
    }
    let refreshDied = false;
    const result = await disconnectConnectGrant(
      apiUrl,
      credentials.accessToken,
      {
        local,
        refreshAccessToken:
          refreshSaved && credentials.refreshToken
            ? async () => {
                const auth = await discover(true);
                if (!matches(credentials, auth)) {
                  throw new Error(
                    "The saved sign-in belongs to another sign-in server."
                  );
                }
                const renewed = await refresh(credentials, auth);
                refreshDied = renewed === null;
                return renewed?.accessToken ?? null;
              }
            : undefined,
      }
    );
    if (result === "disconnected") {
      return "disconnected";
    }
    if (result === "refresh_rejected" || refreshDied) {
      return "signed-out-here";
    }
    throw new Error("Teak did not confirm the disconnect.");
  };

  /**
   * The saved sign-in's credentials for a request: fresh ones as they are,
   * expired (or, after a 401, rejected) ones refreshed. Null when there is
   * no usable sign-in.
   */
  const credentialsFor = (
    rejectedToken?: string
  ): Promise<OAuthCredentials | null> =>
    lock(async () => {
      const startedAt = signOutEpoch;
      const signedOut = () => startedAt !== signOutEpoch;
      const current = await store.read();
      if (!current) {
        return null;
      }
      const force = rejectedToken !== undefined;
      if (fresh(current) && !force && boundHere(current)) {
        return signedOut() ? null : hand(current);
      }
      const auth = await discover(force);
      if (!matches(current, auth)) {
        return null;
      }
      // Another request already replaced the rejected token.
      const replaced =
        force &&
        (current.accessToken !== rejectedToken ||
          current.refreshToken !== issued.get(rejectedToken));
      if (fresh(current) && (!force || replaced)) {
        return signedOut() ? null : hand(current);
      }
      if (!current.refreshToken) {
        return null;
      }
      const renewed = await refresh(current, auth);
      if (!renewed) {
        return null;
      }
      const latest = await discover();
      if (signedOut()) {
        // Sign-out ran while this refresh did: the rotated grant is still
        // live, so it is disconnected too, and never reaches the API.
        if (matches(renewed, latest)) {
          await revoke(renewed, false).catch(() => undefined);
        }
        await store.write(null);
        return null;
      }
      return matches(renewed, latest) ? hand(renewed) : null;
    });

  // Concurrent reads share one resolution; a 401 waits for it and asks again.
  let pending: Promise<OAuthCredentials | null> | undefined;
  const resolve = (
    rejectedToken?: string
  ): Promise<OAuthCredentials | null> => {
    if (pending) {
      return rejectedToken === undefined
        ? pending
        : pending.then(
            () => resolve(rejectedToken),
            () => resolve(rejectedToken)
          );
    }
    const work = credentialsFor(rejectedToken);
    pending = work;
    void work
      .finally(() => {
        if (pending === work) {
          pending = undefined;
        }
      })
      .catch(() => undefined);
    return work;
  };

  /**
   * A token provider over the saved sign-in. With `ownerId`, a sign-in for
   * another account is refused instead of used.
   */
  const tokenProvider = (
    providerOptions: { ownerId?: string } = {}
  ): TokenProvider => {
    const owned = (credentials: OAuthCredentials | null) => {
      if (
        credentials &&
        providerOptions.ownerId &&
        credentials.ownerId !== providerOptions.ownerId
      ) {
        throw new OAuthSessionError("account_changed");
      }
      return credentials?.accessToken ?? null;
    };
    return {
      getAccessToken: async () => owned(await resolve()),
      onUnauthorized: async (rejectedToken) =>
        owned(await resolve(rejectedToken)),
    };
  };

  /**
   * Signs in through the browser. `authorize` opens the URL and returns the
   * redirect it ends on, at `redirectUri`. A sign-in for another account
   * disconnects the one it replaces.
   */
  const signIn = async (input: {
    authorize: OAuthAuthorize;
    /**
     * Called under the lock just before the new sign-in is saved; true
     * means sign-out ran meanwhile (in this or another process) and the
     * new grant is dropped.
     */
    cancelled?: () => boolean | Promise<boolean>;
    redirectUri: string;
  }): Promise<OAuthCredentials> => {
    const startedAt = signOutEpoch;
    try {
      const auth = await discover(true);
      const saved = await store.read();
      if (saved && matches(saved, auth) && !saved.ownerId) {
        throw new OAuthSessionError("sign_out_first");
      }
      const verifier = randomBase64Url(32);
      const state = randomBase64Url(32);
      const url = createConnectAuthorizeUrl(auth, {
        clientId: clientId(auth),
        codeChallenge: await createPkceChallenge(verifier),
        redirectUri: input.redirectUri,
        state,
      });
      const callback = await input.authorize(url);
      if (!callback) {
        throw new OAuthSessionError("cancelled");
      }
      const result = new URL(String(callback));
      const expected = new URL(input.redirectUri);
      const code = result.searchParams.get("code");
      if (
        result.origin !== expected.origin ||
        result.pathname !== expected.pathname ||
        result.searchParams.get("state") !== state ||
        !code ||
        result.searchParams.has("error")
      ) {
        throw new OAuthSessionError("not_verified");
      }
      // A registration that changed while the browser was open must not
      // receive the code meant for the old one.
      if (startedAt !== signOutEpoch) {
        throw new OAuthSessionError("signed_out");
      }
      const current = await discover(true);
      if (
        current.issuer !== auth.issuer ||
        clientId(current) !== clientId(auth)
      ) {
        throw new OAuthSessionError("provider_changed");
      }
      const credentials = await grant(current, {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: input.redirectUri,
      });
      if (!credentials) {
        throw signInFailed();
      }
      const ownerId = await fetchConnectOwnerId(
        apiUrl,
        credentials.accessToken,
        { local }
      );
      if (!ownerId) {
        throw new OAuthSessionError("account_unverified");
      }
      const signedIn = { ...credentials, ownerId };
      await lock(async () => {
        if (startedAt !== signOutEpoch || (await input.cancelled?.())) {
          throw new OAuthSessionError("signed_out");
        }
        const latest = await discover(true);
        if (!matches(signedIn, latest)) {
          throw new OAuthSessionError("provider_changed");
        }
        const previous = await store.read();
        const sameOwner =
          previous &&
          matches(previous, latest) &&
          previous.ownerId === signedIn.ownerId;
        if (previous && !sameOwner) {
          if (matches(previous, latest) && !previous.ownerId) {
            throw new OAuthSessionError("sign_out_first");
          }
          try {
            await revoke(previous, true);
          } catch {
            // One from a registration the deployment no longer lists can't
            // be refreshed to disconnect it; it gives way to the new one.
            if (matches(previous, latest)) {
              throw new OAuthSessionError("previous_kept");
            }
          }
        }
        await store.write(signedIn);
      });
      return signedIn;
    } catch (error) {
      await rediscover();
      throw error;
    }
  };

  /**
   * Disconnects this sign-in from Teak and clears it. `signed-out-here`
   * means Teak couldn't be told (the grant was already dead), so other
   * installations stay connected until disconnected in Settings. Throws,
   * keeping the sign-in, when Teak can't be reached.
   */
  const signOut = (): Promise<OAuthSignOutResult> => {
    signOutEpoch += 1;
    return lock(async () => {
      const credentials = await store.read();
      const result = credentials
        ? await revoke(credentials, true)
        : "disconnected";
      await store.write(null);
      return result;
    });
  };

  return { discover, signIn, signOut, tokenProvider };
};

export type OAuthSession = ReturnType<typeof createOAuthSession>;
