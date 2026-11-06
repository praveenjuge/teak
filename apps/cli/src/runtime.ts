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
import { isLocalDevelopmentHostname } from "@teak/convex/devUrls";
import {
  createOAuthSession,
  createTeakClient,
  type OAuthCredentialStore,
  type OAuthCredentials,
  type OAuthSession,
  TeakApiError,
  type TeakClient,
  type TokenProvider,
} from "teak-sdk";
import { credentialLockPath, withCredentialLock } from "./credentialLock";
import {
  describeError,
  type ErrorContext,
  formatErrorText,
  isUsage,
} from "./errors";
import { isInteractive } from "./mode";

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
  fields?: string[];
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
    refreshToken: typeof raw.refreshToken === "string" ? raw.refreshToken : "",
    expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : 0,
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

export const apiBaseUrl = (options: ClientOptions) =>
  withoutTrailingSlashes(
    options.apiUrl || process.env.TEAK_API_URL || DEFAULT_API_URL
  );
const explicitAuthUrl = (options: ClientOptions) => {
  const explicitAuth = options.authUrl || process.env.TEAK_AUTH_URL;
  return explicitAuth
    ? new URL(withoutTrailingSlashes(explicitAuth))
    : undefined;
};
const fromStored = (
  stored: StoredCredentials | null
): OAuthCredentials | null =>
  stored && {
    accessToken: stored.accessToken,
    expiresAt: stored.expiresAt,
    refreshToken: stored.refreshToken,
    ...(stored.binding
      ? {
          origin: stored.binding.apiUrl,
          issuer: stored.binding.issuer,
          clientId: stored.binding.clientId,
          ...(stored.binding.ownerId
            ? { ownerId: stored.binding.ownerId }
            : {}),
        }
      : {}),
  };
const toStored = (credentials: OAuthCredentials): StoredCredentials => ({
  accessToken: credentials.accessToken,
  expiresAt: credentials.expiresAt,
  refreshToken: credentials.refreshToken,
  ...(credentials.origin && credentials.issuer && credentials.clientId
    ? {
        binding: {
          apiUrl: credentials.origin,
          issuer: credentials.issuer,
          clientId: credentials.clientId,
          ...(credentials.ownerId ? { ownerId: credentials.ownerId } : {}),
        },
      }
    : {}),
});
const credentialStore = (options: ClientOptions): OAuthCredentialStore => ({
  read: () => fromStored(readCredentials(options)),
  write: (credentials) =>
    credentials
      ? writeCredentials(toStored(credentials), options)
      : clearCredentials(options),
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
/** The CLI's sign-in: kept in the keychain or a file, one process at a time. */
const oauthSession = (options: ClientOptions): OAuthSession => {
  const authUrl = explicitAuthUrl(options);
  const localIssuer =
    authUrl &&
    (isLocalDevelopmentHostname(authUrl.hostname) ||
      authUrl.hostname === "[::1]")
      ? authUrl.href
      : undefined;
  return createOAuthSession({
    apiUrl: apiBaseUrl(options),
    surface: "cli",
    store: credentialStore(options),
    lock: (work) => credentialOperation(options, work),
    ...(authUrl ? { expectedIssuer: authUrl.href } : {}),
    ...(localIssuer ? { localIssuer } : {}),
  });
};
const logoutMarker = (options: ClientOptions) =>
  path.join(configDir(), `logout-${credentialAccount(options)}`);
const readLogoutMarker = (options: ClientOptions) =>
  existsSync(logoutMarker(options))
    ? readFileSync(logoutMarker(options), "utf8")
    : "";
export const logout = async (options: ClientOptions = {}) => {
  ensureConfigDir();
  // A sign-in finishing in another process sees this and drops its grant.
  writeFileSync(logoutMarker(options), randomBytes(16).toString("hex"), {
    mode: 0o600,
  });
  let result: Awaited<ReturnType<OAuthSession["signOut"]>>;
  try {
    result = await oauthSession(options).signOut();
  } catch {
    throw new Error(
      "Could not disconnect Teak CLI. Your credentials are still saved. Check your connection and run teak logout again."
    );
  }
  return result === "signed-out-here"
    ? "Signed out on this device. To disconnect other installations, use Settings → Security → Connected apps."
    : "Logged out of Teak.";
};
const tokenProvider = (options: ClientOptions): TokenProvider => {
  const explicit = options.apiKey || process.env.TEAK_API_KEY;
  return explicit
    ? { getAccessToken: () => explicit }
    : oauthSession(options).tokenProvider();
};

export const client = (options: ClientOptions): TeakClient =>
  createTeakClient({
    baseUrl: apiBaseUrl(options),
    timeoutMs: Number(process.env.TEAK_API_REQUEST_TIMEOUT_MS) || 10_000,
    tokenProvider: tokenProvider(options),
    userAgent: `teak-cli/${VERSION}`,
  });

const pickFields = (value: unknown, fields: string[]) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    fields
      .filter((field) => field in record)
      .map((field) => [field, record[field]])
  );
};

/**
 * `--fields id,url` keeps those keys: of each item in a listing (its paging
 * stays), of each element of an array, or of a single result.
 */
export const selectFields = (value: unknown, fields?: string[]): unknown => {
  if (!fields?.length) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => pickFields(item, fields));
  }
  const record = value as Record<string, unknown> | null;
  if (record && typeof record === "object" && Array.isArray(record.items)) {
    return {
      ...record,
      items: record.items.map((item) => pickFields(item, fields)),
    };
  }
  return pickFields(value, fields);
};

export const write = (value: unknown, options: GlobalOptions) => {
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(selectFields(value, options.fields), null, 2)}\n`
    );
    return;
  }
  process.stdout.write(`${String(value)}\n`);
};

/** Status for a person, never the answer: it goes to stderr. */
export const writeStatus = (text: string, options: GlobalOptions) => {
  if (!options.json) {
    process.stderr.write(`${text}\n`);
  }
};

/**
 * A next step after a success, for a person at a terminal only: never in JSON,
 * a pipe, CI or an agent's shell.
 */
export const writeTip = (text: string, options: GlobalOptions) => {
  if (!options.json && isInteractive()) {
    process.stderr.write(`${text}\n`);
  }
};

// A human listing with nothing in it says so on stderr and leaves stdout
// empty, so a pipe gets no stray blank line and a person gets an answer.
export const writeList = (
  lines: string[],
  emptyMessage: string,
  options: GlobalOptions
) => {
  if (lines.length === 0) {
    process.stderr.write(`${emptyMessage}\n`);
    return;
  }
  write(lines.join("\n"), options);
};

/**
 * One error on stderr: with --json a single JSON line, otherwise the
 * headline, the request id and what to do next.
 */
export const writeError = (
  error: unknown,
  options: GlobalOptions,
  context: Omit<ErrorContext, "apiUrl"> = {}
) => {
  const report = describeError(error, {
    ...context,
    apiUrl: apiBaseUrl(options),
  });
  process.stderr.write(
    `${options.json ? JSON.stringify({ error: report }) : formatErrorText(report)}\n`
  );
};

export const exitCodeFor = (error: unknown) => {
  if (isUsage(error)) {
    return EXIT.usage;
  }
  switch (error instanceof TeakApiError ? error.kind : undefined) {
    case "auth":
      return EXIT.auth;
    case "not_found":
      return EXIT.notFound;
    case "rate_limited":
      return EXIT.rateLimited;
    default:
      return EXIT.api;
  }
};

// Not `cmd /c start` on Windows: cmd reads the `&` between query parameters
// as a command separator, which drops the rest of the link and runs what
// follows it.
export const browserCommand = (
  os: NodeJS.Platform,
  url: string
): [string, string[]] => {
  if (os === "darwin") {
    return ["open", [url]];
  }
  if (os === "win32") {
    return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  }
  return ["xdg-open", [url]];
};

export const openBrowser = (url: string): Promise<boolean> => {
  const [command, args] = browserCommand(platform(), url);
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

const SIGN_IN_PORTS = [14_210, 24_210];
const SIGN_IN_TIMEOUT_MS = 300_000;

const sameText = (received: string, expected: string) => {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Waits on a loopback port for the browser's redirect back from sign-in.
 * Redirects for another sign-in are answered 400 and ignored; the one that
 * matches stays open until `finish` says how the sign-in ended.
 */
const listenForRedirect = (
  port: number,
  redirectUri: string,
  options: { browser?: boolean }
) => {
  let answer: ((ok: boolean) => void) | undefined;
  const server = createServer();
  const close = () => server.close();
  const authorize = (url: URL) =>
    new Promise<string>((resolve, reject) => {
      const state = url.searchParams.get("state") ?? "";
      const timer = setTimeout(() => {
        close();
        reject(new Error("Timed out waiting for browser sign-in."));
      }, SIGN_IN_TIMEOUT_MS);
      server.on("request", (request, response) => {
        const callback = new URL(request.url || "/", redirectUri);
        if (
          callback.pathname !== "/oauth/callback" ||
          !sameText(callback.searchParams.get("state") || "", state)
        ) {
          response.writeHead(400).end("Invalid Teak sign-in callback.");
          return;
        }
        if (answer) {
          response.writeHead(409).end("Sign-in is already completing.");
          return;
        }
        clearTimeout(timer);
        answer = (ok) => {
          response
            .writeHead(ok ? 200 : 400, { "Content-Type": "text/html" })
            .end(
              ok
                ? "<p>Return to your terminal to finish signing in.</p>"
                : "<p>Teak sign-in could not complete. Run teak login again.</p>"
            );
          close();
        };
        resolve(callback.href);
      });
      server.on("error", (error) => {
        clearTimeout(timer);
        close();
        reject(error);
      });
      server.listen(port, "127.0.0.1", () => {
        process.stderr.write(`${url.toString()}\n`);
        if (options.browser === false || !isInteractive()) {
          process.stderr.write("Open the link above to sign in.\n");
          return;
        }
        void openBrowser(url.toString()).then((opened) => {
          if (!opened) {
            process.stderr.write(
              "Couldn't open a browser. Open the link above to sign in.\n"
            );
          }
        });
      });
    });
  const finish = (ok: boolean) => {
    if (answer) {
      answer(ok);
    } else {
      close();
    }
  };
  return { authorize, finish };
};

export const login = async (options: ClientOptions & { browser?: boolean }) => {
  const logoutEpochAtStart = readLogoutMarker(options);
  const session = oauthSession(options);
  for (const port of SIGN_IN_PORTS) {
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
    const redirect = listenForRedirect(port, redirectUri, options);
    try {
      await session.signIn({
        authorize: redirect.authorize,
        cancelled: () => readLogoutMarker(options) !== logoutEpochAtStart,
        redirectUri,
      });
      redirect.finish(true);
      return "Logged in to Teak.";
    } catch (error) {
      redirect.finish(false);
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not bind a local OAuth callback port.");
};
