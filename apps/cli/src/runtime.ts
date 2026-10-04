import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir, platform } from "node:os";
import path from "node:path";
import { isLocalDevelopmentHostname } from "@teak/convex/dev-urls";
import {
  type AuthDiscovery,
  createTeakClient,
  discoverAuthServer,
  TeakApiError,
  type TeakClient,
  type TokenProvider,
  validateOAuthUrl,
} from "@teak/convex/sdk";
import { readResponseTextWithinLimit } from "@teak/convex/shared/bounded-response";
import { InvalidArgumentError } from "commander";
import { withCredentialLock } from "./credentialLock";

const readPackageVersion = () => {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
};

export const VERSION = readPackageVersion();
export const EXIT = { api: 1, auth: 3, notFound: 4, rateLimited: 5, usage: 2 };

const DEFAULT_API_URL = "https://teakvault.com/api";
const DEFAULT_AUTH_URL = "https://app.teakvault.com";
export const CLI_OAUTH_SCOPE = "profile email offline_access";
const SERVICE = "com.teakvault.cli";
const ACCOUNT = "default";

interface StoredCredentials {
  accessToken: string;
  binding?: {
    apiUrl: string;
    issuer: string;
    clientId: string;
    revocationEndpoint?: string;
  };
  expiresAt: number;
  refreshToken: string;
}

export interface GlobalOptions {
  apiKey?: string;
  apiUrl?: string;
  json?: boolean;
}

export interface ClientOptions extends GlobalOptions {
  authUrl?: string;
}

export const readJson = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const configDir = () =>
  path.join(
    process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
    "teak"
  );
const credentialAccount = (options: ClientOptions) =>
  apiBaseUrl(options) === DEFAULT_API_URL
    ? ACCOUNT
    : createHash("sha256").update(apiBaseUrl(options)).digest("hex");
const credentialsPath = (options: ClientOptions) =>
  path.join(
    configDir(),
    credentialAccount(options) === ACCOUNT
      ? "credentials.json"
      : `credentials-${credentialAccount(options)}.json`
  );
const ensureConfigDir = () => {
  mkdirSync(configDir(), { mode: 0o700, recursive: true });
  chmodSync(configDir(), 0o700);
};
const b64url = (bytes: Buffer | Uint8Array) =>
  Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/g, "");
const sha256 = (value: string) =>
  b64url(createHash("sha256").update(value).digest());

const parseCredentials = (text: string): StoredCredentials | null => {
  if (text.length > 64 * 1024) {
    return null;
  }
  const raw = readJson<Record<string, unknown>>(text);
  if (
    !raw ||
    Array.isArray(raw) ||
    typeof raw.accessToken !== "string" ||
    !raw.accessToken ||
    (raw.refreshToken !== undefined && typeof raw.refreshToken !== "string") ||
    (raw.expiresAt !== undefined &&
      (typeof raw.expiresAt !== "number" ||
        !Number.isSafeInteger(raw.expiresAt) ||
        raw.expiresAt < 0))
  ) {
    return null;
  }
  let savedBinding: StoredCredentials["binding"];
  if (raw.binding !== undefined) {
    if (
      !raw.binding ||
      typeof raw.binding !== "object" ||
      Array.isArray(raw.binding)
    ) {
      return null;
    }
    const value = raw.binding as Record<string, unknown>;
    if (
      typeof value.apiUrl !== "string" ||
      typeof value.issuer !== "string" ||
      typeof value.clientId !== "string" ||
      (value.revocationEndpoint !== undefined &&
        typeof value.revocationEndpoint !== "string")
    ) {
      return null;
    }
    savedBinding = {
      apiUrl: value.apiUrl,
      issuer: value.issuer,
      clientId: value.clientId,
      ...(value.revocationEndpoint
        ? { revocationEndpoint: value.revocationEndpoint as string }
        : {}),
    };
  }
  return {
    accessToken: raw.accessToken,
    refreshToken: (raw.refreshToken as string) ?? "",
    expiresAt: (raw.expiresAt as number) ?? 0,
    ...(savedBinding ? { binding: savedBinding } : {}),
  };
};
export const readCredentials = (
  options: ClientOptions = {}
): StoredCredentials | null => {
  if (platform() === "darwin") {
    const found = spawnSync(
      "security",
      [
        "find-generic-password",
        "-a",
        credentialAccount(options),
        "-s",
        SERVICE,
        "-w",
      ],
      { encoding: "utf8" }
    );
    if (found.status === 0 && found.stdout.trim()) {
      return parseCredentials(found.stdout.trim());
    }
  }
  if (!existsSync(credentialsPath(options))) {
    return null;
  }
  return parseCredentials(readFileSync(credentialsPath(options), "utf8"));
};

const writeCredentials = (
  credentials: StoredCredentials,
  options: ClientOptions
) => {
  const payload = JSON.stringify(credentials);
  if (platform() === "darwin") {
    const saved = spawnSync(
      "security",
      [
        "add-generic-password",
        "-U",
        "-a",
        credentialAccount(options),
        "-s",
        SERVICE,
        "-w",
        payload,
      ],
      { encoding: "utf8" }
    );
    if (saved.status === 0) {
      return;
    }
  }
  ensureConfigDir();
  const destination = credentialsPath(options);
  const temporary = `${destination}.${randomBytes(16).toString("hex")}.tmp`;
  writeFileSync(temporary, payload, { mode: 0o600, flag: "wx" });
  renameSync(temporary, destination);
};

export const clearCredentials = (options: ClientOptions = {}) => {
  if (platform() === "darwin") {
    spawnSync(
      "security",
      [
        "delete-generic-password",
        "-a",
        credentialAccount(options),
        "-s",
        SERVICE,
      ],
      {
        encoding: "utf8",
      }
    );
  }
  if (existsSync(credentialsPath(options))) {
    writeFileSync(credentialsPath(options), "", { mode: 0o600 });
  }
};

const withoutTrailingSlashes = (value: string) => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
};

const authBaseUrl = (options: ClientOptions) =>
  withoutTrailingSlashes(
    options.authUrl || process.env.TEAK_AUTH_URL || DEFAULT_AUTH_URL
  );
const apiBaseUrl = (options: ClientOptions) =>
  withoutTrailingSlashes(
    options.apiUrl || process.env.TEAK_API_URL || DEFAULT_API_URL
  );
const discovery = async (options: ClientOptions, forceRefresh = false) => {
  const explicitAuth = options.authUrl || process.env.TEAK_AUTH_URL;
  const authUrl = explicitAuth ? new URL(authBaseUrl(options)) : undefined;
  const local =
    authUrl &&
    (isLocalDevelopmentHostname(authUrl.hostname) ||
      authUrl.hostname === "[::1]");
  const auth = await discoverAuthServer(apiBaseUrl(options), {
    forceRefresh,
    ...(local ? { localIssuer: authUrl.href } : {}),
  });
  if (
    authUrl &&
    withoutTrailingSlashes(authUrl.href) !== withoutTrailingSlashes(auth.issuer)
  ) {
    throw new Error(
      "Discovered authentication server does not match TEAK_AUTH_URL."
    );
  }
  return auth;
};
const binding = (options: ClientOptions, auth: AuthDiscovery) => ({
  apiUrl: apiBaseUrl(options),
  issuer: auth.issuer,
  clientId: auth.clients.cli,
  ...(auth.revocationEndpoint
    ? { revocationEndpoint: auth.revocationEndpoint }
    : {}),
});
const matchesProvider = (
  credentials: StoredCredentials,
  options: ClientOptions,
  auth: AuthDiscovery
) => {
  const saved = credentials.binding;
  if (!saved) {
    // Only the original production installation has an unambiguous legacy owner.
    return (
      apiBaseUrl(options) === DEFAULT_API_URL &&
      auth.primary === "betterauth" &&
      auth.issuer === DEFAULT_AUTH_URL &&
      auth.clients.cli === "teak-cli"
    );
  }
  const next = binding(options, auth);
  return (
    saved.apiUrl === next.apiUrl &&
    saved.issuer === next.issuer &&
    saved.clientId === next.clientId
  );
};
const credentialOperation = <T>(
  options: ClientOptions,
  work: () => Promise<T>
) => {
  ensureConfigDir();
  return withCredentialLock(
    path.join(configDir(), `credentials-${credentialAccount(options)}.lock`),
    work
  );
};
const logoutMarker = (options: ClientOptions) =>
  path.join(configDir(), `logout-${credentialAccount(options)}`);
const readLogoutMarker = (options: ClientOptions) =>
  existsSync(logoutMarker(options))
    ? readFileSync(logoutMarker(options), "utf8")
    : "";
const localHostname = (hostname: string) =>
  isLocalDevelopmentHostname(hostname) || hostname === "[::1]";
const revokeCredentials = async (
  credentials: StoredCredentials,
  options: ClientOptions,
  useDiscovery = true
) => {
  let endpoint = credentials.binding?.revocationEndpoint;
  let clientId = credentials.binding?.clientId;
  if (useDiscovery) {
    const auth = await discovery(options, true);
    if (matchesProvider(credentials, options, auth)) {
      endpoint = auth.revocationEndpoint;
      clientId = auth.clients.cli;
    }
  }
  if (!(endpoint && clientId)) {
    throw new Error("Revocation unavailable");
  }
  const apiOrigin = new URL(apiBaseUrl(options));
  const issuer = new URL(credentials.binding?.issuer ?? DEFAULT_AUTH_URL);
  const url = validateOAuthUrl(
    endpoint,
    localHostname(apiOrigin.hostname) || localHostname(issuer.hostname)
  );
  if (
    localHostname(url.hostname) &&
    url.origin !== apiOrigin.origin &&
    url.origin !== issuer.origin
  ) {
    throw new Error("Unapproved loopback revocation server");
  }
  const response = await fetch(url.href, {
    body: new URLSearchParams({
      client_id: clientId,
      token: credentials.refreshToken || credentials.accessToken,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error("Revocation failed");
  }
};
export const logout = (options: ClientOptions = {}) =>
  credentialOperation(options, async () => {
    writeFileSync(logoutMarker(options), randomBytes(16).toString("hex"), {
      mode: 0o600,
    });
    const credentials = readCredentials(options);
    if (credentials && (credentials.refreshToken || credentials.accessToken)) {
      try {
        await revokeCredentials(credentials, options);
      } catch {
        throw new Error(
          "Could not disconnect Teak CLI. Your credentials are still saved. Check your connection and run teak logout again."
        );
      }
    }
    clearCredentials(options);
  });
const exchangeToken = async (
  options: ClientOptions,
  auth: AuthDiscovery,
  body: Record<string, string>
): Promise<StoredCredentials> => {
  const response = await fetch(auth.tokenEndpoint, {
    body: new URLSearchParams({
      ...body,
      client_id: auth.clients.cli,
      ...(auth.primary === "workos"
        ? { resource: new URL("/api", auth.resource).href }
        : {}),
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await readResponseTextWithinLimit(response, 64 * 1024);
  const payload =
    text === null ? null : readJson<Record<string, unknown>>(text);
  if (
    !response.ok &&
    body.grant_type === "refresh_token" &&
    (response.status === 401 ||
      payload?.error === "invalid_grant" ||
      payload?.error === "invalid_refresh_token" ||
      payload?.code === "invalid_refresh_token")
  ) {
    throw new TeakApiError("AUTH_REQUIRED", undefined, {
      status: response.status,
    });
  }
  if (
    !(response.ok && payload) ||
    typeof payload.access_token !== "string" ||
    !payload.access_token ||
    typeof payload.refresh_token !== "string" ||
    !payload.refresh_token ||
    typeof payload.expires_in !== "number" ||
    !Number.isSafeInteger(payload.expires_in) ||
    payload.expires_in <= 0 ||
    payload.expires_in > 365 * 24 * 3600
  ) {
    throw new TeakApiError("UNAUTHORIZED", "Could not complete Teak sign-in.", {
      status: response.status,
    });
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
    binding: binding(options, auth),
  };
};
const tokenProvider = (options: ClientOptions): TokenProvider => {
  let pending: Promise<string | null> | undefined;
  const issued = new Map<string, string>();
  const remember = (value: StoredCredentials) => {
    if (!issued.has(value.accessToken)) {
      issued.set(value.accessToken, value.refreshToken);
      if (issued.size > 2) {
        const oldest = issued.keys().next().value;
        if (oldest !== undefined) {
          issued.delete(oldest);
        }
      }
    }
    return value.accessToken;
  };
  const explicit = options.apiKey || process.env.TEAK_API_KEY;
  if (explicit) {
    return { getAccessToken: () => explicit };
  }
  const resolve = (rejectedToken?: string): Promise<string | null> => {
    const force = rejectedToken !== undefined;
    if (pending) {
      return force ? pending.then(() => resolve(rejectedToken)) : pending;
    }
    const work = credentialOperation(options, async () => {
      const current = readCredentials(options);
      if (!current) {
        return null;
      }
      const auth = await discovery(options, force);
      // Keep old-provider credentials for explicit revocation, never use them.
      if (!matchesProvider(current, options, auth)) {
        return null;
      }
      if (
        current.expiresAt - Date.now() >= 60_000 &&
        (!force ||
          current.accessToken !== rejectedToken ||
          current.refreshToken !== issued.get(rejectedToken ?? ""))
      ) {
        return remember(current);
      }
      if (!current.refreshToken) {
        return null;
      }
      try {
        const next = await exchangeToken(options, auth, {
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
        });
        writeCredentials(next, options);
        const latest = await discovery(options, true);
        if (!matchesProvider(next, options, latest)) {
          return null;
        }
        return remember(next);
      } catch (error) {
        if (error instanceof TeakApiError && error.code === "AUTH_REQUIRED") {
          clearCredentials(options);
        }
        try {
          await discovery(options, true);
        } catch {
          /* Preserve the original error. */
        }
        throw error;
      }
    });
    pending = work;
    void work
      .finally(() => {
        if (pending === work) {
          pending = undefined;
        }
      })
      .catch(() => {});
    return work;
  };
  return {
    getAccessToken: () => resolve(),
    onUnauthorized: (rejectedToken) => resolve(rejectedToken),
  };
};

export const client = (options: ClientOptions): TeakClient =>
  createTeakClient({
    baseUrl: apiBaseUrl(options),
    timeoutMs: Number(process.env.TEAK_API_REQUEST_TIMEOUT_MS) || 10_000,
    tokenProvider: tokenProvider(options),
    userAgent: `teak-cli/${VERSION}`,
  });

export const write = (value: unknown, options: GlobalOptions) => {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${String(value)}\n`);
};

export const writeError = (error: unknown, options: GlobalOptions) => {
  if (options.json) {
    const code = error instanceof TeakApiError ? error.code : "REQUEST_FAILED";
    const message = error instanceof Error ? error.message : "Request failed";
    process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
    return;
  }
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
};

export const exitCodeFor = (error: unknown) => {
  if (error instanceof InvalidArgumentError) {
    return EXIT.usage;
  }
  if (!(error instanceof TeakApiError)) {
    return EXIT.api;
  }
  if (
    error.code === "AUTH_REQUIRED" ||
    error.code === "UNAUTHORIZED" ||
    error.code === "INVALID_API_KEY"
  ) {
    return EXIT.auth;
  }
  if (error.code === "NOT_FOUND") {
    return EXIT.notFound;
  }
  if (error.code === "RATE_LIMITED") {
    return EXIT.rateLimited;
  }
  return EXIT.api;
};

const openBrowser = (url: string) => {
  let command = "xdg-open";
  if (platform() === "darwin") {
    command = "open";
  } else if (platform() === "win32") {
    command = "cmd";
  }
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
};

export const createAuthorizeUrl = (
  auth: AuthDiscovery,
  params: {
    codeChallenge: string;
    redirectUri: string;
    state: string;
  }
) => {
  const authUrl = new URL(auth.authorizationEndpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", auth.clients.cli);
  if (auth.primary === "workos") {
    authUrl.searchParams.set("resource", new URL("/api", auth.resource).href);
  }
  authUrl.searchParams.set("redirect_uri", params.redirectUri);
  authUrl.searchParams.set("code_challenge", params.codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("scope", CLI_OAUTH_SCOPE);
  authUrl.searchParams.set("state", params.state);
  return authUrl;
};

export const login = async (options: ClientOptions & { browser?: boolean }) => {
  const signoutEpoch = readLogoutMarker(options);
  const auth = await discovery(options, true);
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(24));
  for (const port of [14_210, 24_210]) {
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    try {
      const credentials = await new Promise<StoredCredentials>(
        (resolve, reject) => {
          const timer = setTimeout(() => {
            server.close();
            reject(new Error("Timed out waiting for browser sign-in."));
          }, 300_000);
          let exchanging = false;
          const server = createServer(async (request, response) => {
            const url = new URL(request.url || "/", redirectUri);
            const sameState = url.searchParams.get("state") || "";
            const receivedState = Buffer.from(sameState);
            const expectedState = Buffer.from(state);
            const validState =
              receivedState.length === expectedState.length &&
              timingSafeEqual(expectedState, receivedState);
            if (url.pathname !== "/oauth/callback" || !validState) {
              response.writeHead(400).end("Invalid Teak sign-in callback.");
              return;
            }
            if (exchanging) {
              response.writeHead(409).end("Sign-in is already completing.");
              return;
            }
            exchanging = true;
            try {
              const latest = await discovery(options, true);
              if (
                latest.issuer !== auth.issuer ||
                latest.clients.cli !== auth.clients.cli
              ) {
                throw new Error(
                  "Authentication changed during sign-in. Run teak login again."
                );
              }
              if (
                !url.searchParams.get("code") ||
                url.searchParams.has("error")
              ) {
                throw new Error(
                  "Sign-in was not completed. Run teak login again."
                );
              }
              const next = await exchangeToken(options, latest, {
                code: url.searchParams.get("code") || "",
                code_verifier: verifier,
                grant_type: "authorization_code",
                redirect_uri: redirectUri,
              });
              response
                .writeHead(200, { "Content-Type": "text/html" })
                .end("<p>Return to your terminal to finish signing in.</p>");
              clearTimeout(timer);
              server.close();
              resolve(next);
            } catch (error) {
              response
                .writeHead(400, { "Content-Type": "text/html" })
                .end(
                  "<p>Teak sign-in could not complete. Run teak login again.</p>"
                );
              clearTimeout(timer);
              server.close();
              reject(error);
            }
          });
          server.listen(port, "127.0.0.1", () => {
            const authUrl = createAuthorizeUrl(auth, {
              codeChallenge: sha256(verifier),
              redirectUri,
              state,
            });
            process.stdout.write(`${authUrl.toString()}\n`);
            if (options.browser !== false) {
              openBrowser(authUrl.toString());
            }
          });
          server.on("error", (error) => {
            clearTimeout(timer);
            server.close();
            reject(error);
          });
        }
      );
      let committed = false;
      try {
        await credentialOperation(options, async () => {
          if (readLogoutMarker(options) !== signoutEpoch) {
            throw new Error(
              "Sign-in was cancelled by logout. Run teak login again."
            );
          }
          const latest = await discovery(options, true);
          if (!matchesProvider(credentials, options, latest)) {
            throw new Error(
              "Authentication changed during sign-in. Run teak login again."
            );
          }
          const previous = readCredentials(options);
          if (previous) {
            try {
              await revokeCredentials(previous, options);
            } catch {
              throw new Error(
                "Your existing session is still saved. Run teak logout before signing in again."
              );
            }
          }
          writeCredentials(credentials, options);
          committed = true;
        });
      } catch (error) {
        try {
          if (!committed) {
            await revokeCredentials(credentials, options, false);
          }
        } catch {
          /* Preserve the sign-in error. */
        }
        throw error;
      }
      return "Logged in to Teak.";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        continue;
      }
      await discovery(options, true).catch(() => {});
      throw error;
    }
  }
  throw new Error("Could not bind a local OAuth callback port.");
};
