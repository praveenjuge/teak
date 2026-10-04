import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir, platform } from "node:os";
import path from "node:path";
import {
  type AuthDiscovery,
  createTeakClient,
  discoverAuthServer,
  TeakApiError,
  type TeakClient,
  type TokenProvider,
} from "@teak/convex/sdk";
import { readResponseTextWithinLimit } from "@teak/convex/shared/bounded-response";
import { InvalidArgumentError } from "commander";

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
  binding?: { apiUrl: string; issuer: string; clientId: string };
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
      typeof value.clientId !== "string"
    ) {
      return null;
    }
    savedBinding = {
      apiUrl: value.apiUrl,
      issuer: value.issuer,
      clientId: value.clientId,
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
  writeFileSync(credentialsPath(options), payload, { mode: 0o600 });
  chmodSync(credentialsPath(options), 0o600);
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
    authUrl && ["localhost", "127.0.0.1", "[::1]"].includes(authUrl.hostname);
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
export const logout = async (options: ClientOptions = {}) => {
  const credentials = readCredentials(options);
  const token = credentials?.refreshToken || credentials?.accessToken;
  if (token && credentials) {
    try {
      const auth = await discovery(options, true);
      if (matchesProvider(credentials, options, auth)) {
        if (!auth.revocationEndpoint) {
          throw new Error("Revocation unavailable");
        }
        const response = await fetch(auth.revocationEndpoint, {
          body: new URLSearchParams({ client_id: auth.clients.cli, token }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          throw new Error("Revocation failed");
        }
      }
    } catch {
      throw new Error(
        "Could not disconnect Teak CLI. Your credentials are still saved. Check your connection and run teak logout again."
      );
    }
  }
  clearCredentials(options);
};
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
  let current = readCredentials(options);
  let pending: Promise<string | null> | undefined;
  const explicit = options.apiKey || process.env.TEAK_API_KEY;
  if (explicit) {
    return { getAccessToken: () => explicit };
  }
  const select = async (force = false) => {
    const auth = await discovery(options, force);
    if (current && !matchesProvider(current, options, auth)) {
      clearCredentials(options);
      current = null;
    }
    return auth;
  };
  const refresh = (force = false): Promise<string | null> => {
    if (pending) {
      return pending;
    }
    const work = (async () => {
      const auth = await select(force);
      if (!current?.refreshToken) {
        return null;
      }
      const previous = current;
      try {
        const next = await exchangeToken(options, auth, {
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
        });
        if (current !== previous) {
          return null;
        }
        writeCredentials(next, options);
        current = next;
        return current.accessToken;
      } catch (error) {
        if (
          error instanceof TeakApiError &&
          error.code === "AUTH_REQUIRED" &&
          current === previous
        ) {
          clearCredentials(options);
          current = null;
        }
        // Renew discovery, but never resend a rotating refresh token blindly.
        await select(true).catch(() => {});
        throw error;
      }
    })();
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
    getAccessToken: async () => {
      if (!current) {
        return null;
      }
      await select();
      if (!current) {
        return null;
      }
      return current.expiresAt - Date.now() < 60_000
        ? refresh()
        : current.accessToken;
    },
    onUnauthorized: () => refresh(true),
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
                .end(
                  "<p>Teak CLI sign-in complete. You can close this tab.</p>"
                );
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
      writeCredentials(credentials, options);
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
