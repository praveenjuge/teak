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
import {
  isRefreshTokenDead,
  isWorkosCredential,
  matchesBinding,
  refreshAndSave,
} from "@teak/convex/client/oauthCredentials";
import { isLocalDevelopmentHostname } from "@teak/convex/dev-urls";
import {
  type AuthDiscovery,
  createConnectAuthorizeUrl,
  createPkceChallenge,
  createTeakClient,
  disconnectConnectGrant,
  discoverAuthServer,
  fetchConnectOwnerId,
  randomBase64Url,
  requestConnectTokens,
  TeakApiError,
  type TeakClient,
  type TokenProvider,
} from "@teak/convex/sdk";
import { InvalidArgumentError } from "commander";
import { credentialLockPath, withCredentialLock } from "./credentialLock";

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
const SERVICE = "com.teakvault.cli";
const ACCOUNT = "default";

interface StoredCredentials {
  accessToken: string;
  binding?: {
    apiUrl: string;
    issuer: string;
    clientId: string;
    ownerId?: string;
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
      (value.ownerId !== undefined &&
        (typeof value.ownerId !== "string" || !value.ownerId))
    ) {
      return null;
    }
    savedBinding = {
      apiUrl: value.apiUrl,
      issuer: value.issuer,
      clientId: value.clientId,
      ...(typeof value.ownerId === "string" ? { ownerId: value.ownerId } : {}),
    };
  }
  return {
    accessToken: raw.accessToken,
    refreshToken: (raw.refreshToken as string) ?? "",
    expiresAt: (raw.expiresAt as number) ?? 0,
    ...(savedBinding ? { binding: savedBinding } : {}),
  };
};
export const credentialSourceOrder = (
  fileText: string
): ("file" | "keychain")[] =>
  readJson<Record<string, unknown>>(fileText)?.fallbackAuthority === true
    ? ["file"]
    : ["keychain", "file"];
const readKeychain = (options: ClientOptions) => {
  if (platform() !== "darwin") {
    return "";
  }
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
  return found.status === 0 ? found.stdout.trim() : "";
};
export const readCredentials = (
  options: ClientOptions = {}
): StoredCredentials | null => {
  const file = credentialsPath(options);
  const fileText = existsSync(file) ? readFileSync(file, "utf8") : "";
  for (const source of credentialSourceOrder(fileText)) {
    const text = source === "file" ? fileText : readKeychain(options);
    if (text) {
      return parseCredentials(text);
    }
  }
  return null;
};

const writeCredentials = (
  credentials: StoredCredentials,
  options: ClientOptions
) => {
  const payload = JSON.stringify(credentials);
  const destination = credentialsPath(options);
  const authoritativeFallback =
    existsSync(destination) &&
    readJson<Record<string, unknown>>(readFileSync(destination, "utf8"))
      ?.fallbackAuthority === true;
  if (platform() === "darwin") {
    // The command goes over stdin as hex so the tokens never appear in the
    // process list. The account is a fixed name or a hash; neither needs quoting.
    const saved = spawnSync("security", ["-i"], {
      encoding: "utf8",
      input: `add-generic-password -U -a ${credentialAccount(options)} -s ${SERVICE} -X ${Buffer.from(payload, "utf8").toString("hex")}\n`,
    });
    if (saved.status === 0 && !authoritativeFallback) {
      return;
    }
  }
  ensureConfigDir();
  const temporary = `${destination}.${randomBytes(16).toString("hex")}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify({ ...credentials, fallbackAuthority: true }),
    { mode: 0o600, flag: "wx" }
  );
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
});
const savedBinding = ({ binding: saved }: StoredCredentials) =>
  saved && {
    origin: saved.apiUrl,
    issuer: saved.issuer,
    clientId: saved.clientId,
  };
const matchesProvider = (
  credentials: StoredCredentials,
  options: ClientOptions,
  auth: AuthDiscovery
) =>
  matchesBinding(savedBinding(credentials), {
    origin: apiBaseUrl(options),
    issuer: auth.issuer,
    clientId: auth.clients.cli,
  });
const credentialOperation = <T>(
  options: ClientOptions,
  work: () => Promise<T>
) => {
  ensureConfigDir();
  return withCredentialLock(
    credentialLockPath(configDir(), credentialAccount(options)),
    work
  );
};
const logoutMarker = (options: ClientOptions) =>
  path.join(configDir(), `logout-${credentialAccount(options)}`);
const readLogoutMarker = (options: ClientOptions) =>
  existsSync(logoutMarker(options))
    ? readFileSync(logoutMarker(options), "utf8")
    : "";
const LOOPBACK_ALLOWED_AFTER_DISCOVERY = true;
const refreshCredentials = (
  current: StoredCredentials,
  options: ClientOptions,
  auth: AuthDiscovery
) =>
  refreshAndSave(
    async () => {
      const next = await exchangeToken(options, auth, {
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      });
      if (next.binding && current.binding?.ownerId) {
        next.binding.ownerId = current.binding.ownerId;
      }
      return next;
    },
    (next) => writeCredentials(next, options)
  );
const revokeCredentials = async (
  credentials: StoredCredentials,
  options: ClientOptions
) => {
  const saved = savedBinding(credentials);
  if (!isWorkosCredential(saved)) {
    return;
  }
  if (saved.origin !== apiBaseUrl(options)) {
    throw new Error("Saved connection belongs to another deployment");
  }
  const result = await disconnectConnectGrant(
    apiBaseUrl(options),
    credentials.accessToken,
    {
      local: LOOPBACK_ALLOWED_AFTER_DISCOVERY,
      refreshAccessToken: credentials.refreshToken
        ? async () => {
            const auth = await discovery(options, true);
            if (!matchesProvider(credentials, options, auth)) {
              throw new Error("Saved connection belongs to another provider");
            }
            return (await refreshCredentials(credentials, options, auth))
              .accessToken;
          }
        : undefined,
    }
  );
  if (result !== "disconnected") {
    throw new Error("Disconnect was not confirmed");
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
      } catch (error) {
        if (error instanceof TeakApiError && error.code === "AUTH_REQUIRED") {
          clearCredentials(options);
          return "Signed out on this device. To disconnect other installations, use Settings → Security → Connected apps.";
        }
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
  const result = await requestConnectTokens(auth, {
    clientId: auth.clients.cli,
    grant: body,
    local: LOOPBACK_ALLOWED_AFTER_DISCOVERY,
  });
  if (!result.ok) {
    throw isRefreshTokenDead(result)
      ? new TeakApiError("AUTH_REQUIRED", undefined, { status: result.status })
      : new TeakApiError("UNAUTHORIZED", "Could not complete Teak sign-in.", {
          status: result.status,
        });
  }
  const { accessToken, expiresAt, refreshToken } = result.tokens;
  return {
    accessToken,
    expiresAt,
    refreshToken,
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
        const next = await refreshCredentials(current, options, auth);
        const latest = await discovery(options);
        if (!matchesProvider(next, options, latest)) {
          return null;
        }
        return remember(next);
      } catch (error) {
        if (error instanceof TeakApiError && error.code === "AUTH_REQUIRED") {
          clearCredentials(options);
        }
        await discovery(options, true).catch(() => {});
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
  if (error.code === "NOT_FOUND" || error.code === "NO_CONTENT") {
    return EXIT.notFound;
  }
  if (error.code === "RATE_LIMITED") {
    return EXIT.rateLimited;
  }
  return EXIT.api;
};

export const openBrowser = (url: string): Promise<boolean> => {
  let command = "xdg-open";
  if (platform() === "darwin") {
    command = "open";
  } else if (platform() === "win32") {
    command = "cmd";
  }
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
};

export const login = async (options: ClientOptions & { browser?: boolean }) => {
  const signoutEpoch = readLogoutMarker(options);
  const auth = await discovery(options, true);
  const saved = readCredentials(options);
  if (
    saved &&
    matchesProvider(saved, options, auth) &&
    !saved.binding?.ownerId
  ) {
    throw new Error(
      "Run teak logout before signing in again, then wait five minutes for disconnect to finish."
    );
  }
  const verifier = randomBase64Url(32);
  const state = randomBase64Url(24);
  const codeChallenge = await createPkceChallenge(verifier);
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
              const ownerId = await fetchConnectOwnerId(
                apiBaseUrl(options),
                next.accessToken,
                { local: LOOPBACK_ALLOWED_AFTER_DISCOVERY }
              );
              if (!(ownerId && next.binding)) {
                throw new Error(
                  "Could not verify your account. Run teak login again."
                );
              }
              next.binding.ownerId = ownerId;
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
            const authUrl = createConnectAuthorizeUrl(auth, {
              clientId: auth.clients.cli,
              codeChallenge,
              redirectUri,
              state,
            });
            process.stdout.write(`${authUrl.toString()}\n`);
            if (options.browser !== false) {
              void openBrowser(authUrl.toString()).then((opened) => {
                if (!opened) {
                  process.stderr.write(
                    "Couldn't open a browser. Open the link above to sign in.\n"
                  );
                }
              });
            }
          });
          server.on("error", (error) => {
            clearTimeout(timer);
            server.close();
            reject(error);
          });
        }
      );
      // Discarding a failed sign-in must not revoke the same app on other
      // installations. Only explicit logout owns that access change.
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
        const sameOwner =
          previous &&
          matchesProvider(previous, options, latest) &&
          Boolean(previous.binding?.ownerId) &&
          previous.binding?.ownerId === credentials.binding?.ownerId;
        if (previous && !sameOwner) {
          if (
            matchesProvider(previous, options, latest) &&
            !previous.binding?.ownerId
          ) {
            throw new Error("Run teak logout before signing in again.");
          }
          try {
            await revokeCredentials(previous, options);
          } catch {
            throw new Error(
              "Your existing session is still saved. Run teak logout before signing in again."
            );
          }
        }
        writeCredentials(credentials, options);
      });
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
