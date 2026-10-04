export interface WorkosUser {
  email: string;
  emailVerified: boolean;
  id: string;
  name: string;
  teakUserId: string | null;
}
interface Session {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
  sessionId: string;
  user: WorkosUser;
}
export interface WorkosSessionSnapshot {
  isLoading: boolean;
  user: WorkosUser | null;
}
export interface SessionStorage {
  deleteItemAsync: (key: string) => Promise<void>;
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
}
const endpoint = "https://api.workos.com/user_management/authenticate";
const maxResponseLength = 64 * 1024;
class InvalidRefreshToken extends Error {}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid sign-in response");
  }
  return value as Record<string, unknown>;
};
const string = (value: unknown): string => {
  if (typeof value !== "string" || !value || value.length > maxResponseLength) {
    throw new Error("Invalid sign-in response");
  }
  return value;
};

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Invalid sign-in response");
  }
};

// These claims describe the client cache, not authorization. Convex verifies the
// signed token, the live session, verified email and permanent vault mapping.
function parseSession(raw: unknown, clientId: string): Session {
  const body = record(raw);
  const accessToken = string(body.access_token);
  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid session token");
  }
  const claims = record(
    parseJson(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
  );
  const user = record(body.user);
  if (
    claims.iss !== `https://api.workos.com/user_management/${clientId}` ||
    claims.sub !== user.id ||
    typeof claims.sid !== "string" ||
    !claims.sid.startsWith("session_") ||
    typeof claims.exp !== "number" ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp <= 0 ||
    claims.exp > Math.floor(Number.MAX_SAFE_INTEGER / 1000) ||
    typeof user.email_verified !== "boolean" ||
    (user.external_id !== null &&
      user.external_id !== undefined &&
      typeof user.external_id !== "string")
  ) {
    throw new Error("Invalid session token");
  }
  return {
    accessToken,
    refreshToken: string(body.refresh_token),
    expiresAt: claims.exp * 1000,
    sessionId: claims.sid,
    user: {
      id: string(user.id),
      email: string(user.email),
      emailVerified: user.email_verified,
      teakUserId:
        typeof user.external_id === "string" ? user.external_id : null,
      name: [user.first_name, user.last_name]
        .filter((value) => typeof value === "string")
        .join(" "),
    },
  };
}

export class WorkosSession {
  private session: Session | null = null;
  private snapshot: WorkosSessionSnapshot = { isLoading: true, user: null };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private signInAttempt = 0;
  private writes: Promise<void> = Promise.resolve();
  private hydration: Promise<void> | undefined;
  private refresh: Promise<string | null> | undefined;
  private readonly storageKey: string;

  readonly clientId: string;
  private readonly storage: SessionStorage;
  private readonly transport: typeof fetch;
  private readonly timeoutMs: number;
  constructor(
    clientId: string,
    storage: SessionStorage,
    transport: typeof fetch = fetch,
    timeoutMs = 10_000
  ) {
    this.clientId = clientId;
    this.storage = storage;
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    if (!/^client_[A-Za-z0-9]{1,128}$/.test(clientId)) {
      throw new Error("Invalid WorkOS client configuration");
    }
    this.storageKey = `teak.authkit.${clientId}`;
  }

  getSessionId = (): string | null => this.session?.sessionId ?? null;
  getSnapshot = (): WorkosSessionSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(isLoading = false) {
    this.snapshot = { isLoading, user: this.session?.user ?? null };
    for (const listener of this.listeners) {
      listener();
    }
  }
  private write(operation: () => Promise<void>): Promise<void> {
    const pending = this.writes.then(operation);
    this.writes = pending.catch(() => {});
    return pending;
  }

  hydrate(): Promise<void> {
    if (!this.hydration) {
      const pending = this.restore();
      this.hydration = pending;
      void pending.catch(() => {
        if (this.hydration === pending) {
          this.hydration = undefined;
        }
      });
    }
    return this.hydration;
  }
  private async restore(): Promise<void> {
    const generation = this.generation;
    const stored = await this.storage.getItemAsync(this.storageKey);
    try {
      if (generation !== this.generation || !stored) {
        return;
      }
      if (stored.length > maxResponseLength) {
        throw new Error("Invalid cache");
      }
      const cache = record(JSON.parse(stored));
      if (cache.clientId !== this.clientId) {
        throw new Error("Invalid cache");
      }
      this.session = parseSession(cache.response, this.clientId);
    } catch {
      if (generation === this.generation) {
        await this.write(async () => {
          if (generation === this.generation) {
            await this.storage.deleteItemAsync(this.storageKey);
          }
        });
      }
    } finally {
      if (generation === this.generation) {
        this.publish();
      }
    }
  }

  private async authenticate(body: Record<string, string>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(endpoint, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: this.clientId, ...body }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > maxResponseLength) {
        throw new Error("Invalid sign-in response");
      }
      if (!response.ok) {
        let code: unknown;
        try {
          const failure = record(JSON.parse(text));
          code = failure.code ?? failure.error;
        } catch {
          /* No provider details in errors. */
        }
        if (
          body.grant_type === "refresh_token" &&
          (response.status === 401 ||
            code === "invalid_grant" ||
            code === "invalid_refresh_token")
        ) {
          throw new InvalidRefreshToken("Please sign in again");
        }
        throw new Error("Unable to complete sign-in");
      }
      return parseJson(text);
    } finally {
      controller.abort();
      clearTimeout(timer);
    }
  }
  private async save(
    raw: unknown,
    generation: number,
    attempt?: number
  ): Promise<string | null> {
    const next = parseSession(raw, this.clientId);
    if (next.expiresAt <= Date.now()) {
      throw new Error("Expired session token");
    }
    if (
      generation !== this.generation ||
      (attempt !== undefined && attempt !== this.signInAttempt)
    ) {
      return null;
    }
    let committedGeneration = generation;
    await this.write(async () => {
      if (
        generation !== this.generation ||
        (attempt !== undefined && attempt !== this.signInAttempt)
      ) {
        return;
      }
      await this.storage.setItemAsync(
        this.storageKey,
        JSON.stringify({
          clientId: this.clientId,
          response: {
            access_token: next.accessToken,
            refresh_token: next.refreshToken,
            user: Object.fromEntries(
              [
                "id",
                "email",
                "email_verified",
                "external_id",
                "first_name",
                "last_name",
              ].map((key) => [key, record(record(raw).user)[key]])
            ),
          },
        })
      );
      if (
        attempt !== undefined &&
        generation === this.generation &&
        attempt === this.signInAttempt
      ) {
        committedGeneration = ++this.generation;
        this.refresh = undefined;
      }
    });
    if (
      committedGeneration !== this.generation ||
      (attempt !== undefined && attempt !== this.signInAttempt)
    ) {
      return null;
    }
    this.session = next;
    this.publish();
    return next.accessToken;
  }

  beginSignIn(): number {
    return ++this.signInAttempt;
  }

  async exchangeCode(
    code: string,
    verifier: string,
    attempt?: number
  ): Promise<string | null> {
    if (!(code && /^[A-Za-z0-9._~-]{43,128}$/.test(verifier))) {
      throw new Error("Invalid sign-in callback");
    }
    await this.hydrate();
    const loginAttempt = attempt ?? this.beginSignIn();
    const generation = this.generation;
    if (loginAttempt !== this.signInAttempt) {
      return null;
    }
    const raw = await this.authenticate({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
    });
    return this.save(raw, generation, loginAttempt);
  }

  async fetchAccessToken({
    forceRefreshToken = false,
  } = {}): Promise<string | null> {
    await this.hydrate();
    if (!this.session) {
      return null;
    }
    if (!forceRefreshToken && this.session.expiresAt > Date.now() + 30_000) {
      return this.session.accessToken;
    }
    if (this.refresh) {
      return this.refresh;
    }
    const generation = this.generation;
    const current = this.session;
    const pending = (async () => {
      try {
        const raw = await this.authenticate({
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
        });
        const next = parseSession(raw, this.clientId);
        if (
          next.user.id !== current.user.id ||
          next.sessionId !== current.sessionId ||
          (current.user.teakUserId !== null &&
            next.user.teakUserId !== current.user.teakUserId)
        ) {
          throw new Error("Session identity changed; please sign in again");
        }
        return await this.save(raw, generation);
      } catch (error) {
        if (generation !== this.generation) {
          return null;
        }
        if (error instanceof InvalidRefreshToken) {
          await this.clear();
          return null;
        }
        // A transport outage preserves the secure refresh token for reconnect.
        // Never return an expired token to Convex.
        throw error;
      }
    })();
    this.refresh = pending;
    try {
      return await pending;
    } finally {
      if (this.refresh === pending) {
        this.refresh = undefined;
      }
    }
  }

  // Returns the real session ID for AuthKit logout and server revocation. The
  // native flow must complete both; local clearing alone is not server sign-out.
  async clear(): Promise<string | null> {
    ++this.generation;
    ++this.signInAttempt;
    this.refresh = undefined;
    const sessionId = this.session?.sessionId ?? null;
    this.session = null;
    this.publish();
    await this.write(() => this.storage.deleteItemAsync(this.storageKey));
    return sessionId;
  }
}
