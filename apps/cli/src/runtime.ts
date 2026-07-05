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
  createTeakClient,
  TeakApiError,
  type TeakClient,
  type TokenProvider,
} from "@teak/convex/sdk";
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

const DEFAULT_API_URL = "https://api.teakvault.com";
const DEFAULT_AUTH_URL = "https://app.teakvault.com";
export const CLI_OAUTH_SCOPE = "profile email offline_access";
const SERVICE = "com.teakvault.cli";
const ACCOUNT = "default";

interface StoredCredentials {
  accessToken: string;
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
const credentialsPath = () => path.join(configDir(), "credentials.json");
const ensureConfigDir = () => {
  mkdirSync(configDir(), { mode: 0o700, recursive: true });
  chmodSync(configDir(), 0o700);
};
const b64url = (bytes: Buffer | Uint8Array) =>
  Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
const sha256 = (value: string) =>
  b64url(createHash("sha256").update(value).digest());

export const readCredentials = (): StoredCredentials | null => {
  if (platform() === "darwin") {
    const found = spawnSync(
      "security",
      ["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"],
      { encoding: "utf8" }
    );
    if (found.status === 0 && found.stdout.trim()) {
      return readJson<StoredCredentials>(found.stdout.trim());
    }
  }
  if (!existsSync(credentialsPath())) {
    return null;
  }
  return readJson<StoredCredentials>(readFileSync(credentialsPath(), "utf8"));
};

const writeCredentials = (credentials: StoredCredentials) => {
  const payload = JSON.stringify(credentials);
  if (platform() === "darwin") {
    const saved = spawnSync(
      "security",
      [
        "add-generic-password",
        "-U",
        "-a",
        ACCOUNT,
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
  writeFileSync(credentialsPath(), payload, { mode: 0o600 });
  chmodSync(credentialsPath(), 0o600);
};

export const clearCredentials = () => {
  if (platform() === "darwin") {
    spawnSync(
      "security",
      ["delete-generic-password", "-a", ACCOUNT, "-s", SERVICE],
      {
        encoding: "utf8",
      }
    );
  }
  if (existsSync(credentialsPath())) {
    writeFileSync(credentialsPath(), "", { mode: 0o600 });
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
const tokenEndpoint = (options: ClientOptions) =>
  `${authBaseUrl(options)}/api/auth/mcp/token`;
const authorizeEndpoint = (options: ClientOptions) =>
  `${authBaseUrl(options)}/api/auth/mcp/authorize`;

const exchangeToken = async (
  options: ClientOptions,
  body: Record<string, string>
): Promise<StoredCredentials> => {
  const response = await fetch(tokenEndpoint(options), {
    body: new URLSearchParams(body),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (
    !(response.ok && payload) ||
    typeof payload.access_token !== "string" ||
    typeof payload.refresh_token !== "string"
  ) {
    throw new TeakApiError("UNAUTHORIZED", "Could not complete Teak sign-in.", {
      status: response.status,
    });
  }
  return {
    accessToken: payload.access_token,
    expiresAt:
      Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000,
    refreshToken: payload.refresh_token,
  };
};

const tokenProvider = (options: ClientOptions): TokenProvider => {
  let current = readCredentials();
  const explicit = options.apiKey || process.env.TEAK_API_KEY;
  if (explicit) {
    return { getAccessToken: () => explicit };
  }
  const refresh = async () => {
    if (!current?.refreshToken) {
      return null;
    }
    current = await exchangeToken(options, {
      client_id: "teak-cli",
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
    });
    writeCredentials(current);
    return current.accessToken;
  };
  return {
    getAccessToken: () => {
      if (!current) {
        return null;
      }
      return current.expiresAt - Date.now() < 60_000
        ? refresh()
        : current.accessToken;
    },
    onUnauthorized: refresh,
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
  options: ClientOptions,
  params: {
    codeChallenge: string;
    redirectUri: string;
    state: string;
  }
) => {
  const authUrl = new URL(authorizeEndpoint(options));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", "teak-cli");
  authUrl.searchParams.set("redirect_uri", params.redirectUri);
  authUrl.searchParams.set("code_challenge", params.codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("scope", CLI_OAUTH_SCOPE);
  authUrl.searchParams.set("state", params.state);
  return authUrl;
};

export const login = async (options: ClientOptions & { browser?: boolean }) => {
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
          const server = createServer(async (request, response) => {
            const url = new URL(request.url || "/", redirectUri);
            const sameState = url.searchParams.get("state") || "";
            const validState =
              sameState.length === state.length &&
              timingSafeEqual(Buffer.from(state), Buffer.from(sameState));
            if (url.pathname !== "/oauth/callback" || !validState) {
              response.writeHead(400).end("Invalid Teak sign-in callback.");
              return;
            }
            try {
              const next = await exchangeToken(options, {
                client_id: "teak-cli",
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
              clearTimeout(timer);
              server.close();
              reject(error);
            }
          });
          server.listen(port, "127.0.0.1", () => {
            const authUrl = createAuthorizeUrl(options, {
              codeChallenge: sha256(verifier),
              redirectUri,
              state,
            });
            process.stdout.write(`${authUrl.toString()}\n`);
            if (options.browser !== false) {
              openBrowser(authUrl.toString());
            }
          });
          server.on("error", reject);
        }
      );
      writeCredentials(credentials);
      return "Logged in to Teak.";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not bind a local OAuth callback port.");
};
