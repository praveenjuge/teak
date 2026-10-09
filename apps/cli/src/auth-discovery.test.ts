import { afterAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { env, serve, spawn } from "bun";

// The real CLI, callback server, discovery helper and SDK run in isolated child
// processes. Only the authorization server/API and OS credential store are fake.
const directory = mkdtempSync(join(tmpdir(), "teak-discovery-"));
mkdirSync(join(directory, "teak"));
writeFileSync(join(directory, "security"), "#!/bin/sh\nexit 1\n", {
  mode: 0o700,
});
// Two WorkOS environments model a client registration change on the server.
let environment: "alpha" | "beta" = "alpha";
let tokenStatus = 200;
let tokenBody: Record<string, unknown> | undefined;
let refreshes = 0;
let exchanges = 0;
let disconnects = 0;
let applicationRevoked = false;
let rejectRefreshReplay = false;
let apiRequests = 0;
let holdFirstApi = false;
let rotateAccessToken = false;
let apiStarted: Promise<void>;
let apiReleased: Promise<void>;
let notifyApiStarted = () => {};
let releaseApi = () => {};
let discoveryRequests = 0;
let transmitted: URLSearchParams | null = null;
let unsafeTokenEndpoint: string | undefined;
let tokenPath = "/oauth2/token";
let moveTokenEndpoint = false;
let metadataIssuerOrigin: string | undefined;
const clients = () =>
  Object.fromEntries(
    ["cli", "raycast", "chrome", "firefox", "safari"].map((surface) => [
      surface,
      `client_01${environment.toUpperCase()}${surface.toUpperCase()}`,
    ])
  );
const server = serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const issuer = `${metadataIssuerOrigin ?? server.url.origin}/${environment}`;
    if (url.pathname.startsWith("/.well-known/")) {
      discoveryRequests++;
    }
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      return Response.json({
        resource: "https://teakvault.com/mcp",
        authorization_servers: [issuer],
      });
    }
    if (url.pathname === "/.well-known/teak-oauth-clients.json") {
      return Response.json({ primary: "workos", issuer, clients: clients() });
    }
    if (
      url.pathname === `/.well-known/oauth-authorization-server/${environment}`
    ) {
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        token_endpoint: unsafeTokenEndpoint ?? `${issuer}${tokenPath}`,
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === `/${environment}${tokenPath}`) {
      const body = new URLSearchParams(await request.text());
      transmitted = body;
      expect(body.get("client_id")).toBe(clients().cli ?? null);
      expect(body.get("resource")).toBe("https://teakvault.com/api");
      if (body.get("grant_type") === "refresh_token") {
        if (
          rejectRefreshReplay &&
          body.get("refresh_token") !== `refresh-${refreshes}`
        ) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        refreshes++;
      } else {
        exchanges++;
        expect(body.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);
      }
      return Response.json(
        tokenBody ?? {
          access_token: rotateAccessToken ? `access-${refreshes}` : "access",
          refresh_token: `refresh-${refreshes}`,
          expires_in: 3600,
        },
        { status: tokenStatus }
      );
    }
    if (url.pathname === "/v1/oauth/disconnect") {
      expect(request.method).toBe("POST");
      disconnects++;
      applicationRevoked = true;
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/v1/me") {
      return Response.json({
        data: { id: "verified-owner", email: "fixture@example.com" },
      });
    }
    if (url.pathname === "/v1/tags") {
      if (applicationRevoked) {
        return new Response(null, { status: 401 });
      }
      apiRequests++;
      if (holdFirstApi && apiRequests === 1) {
        notifyApiStarted();
        await apiReleased;
        return Response.json(
          { error: { code: "UNAUTHORIZED", message: "Stale response" } },
          { status: 401 }
        );
      }
      expect(request.headers.get("authorization")).toBe(
        rotateAccessToken ? `Bearer access-${refreshes}` : "Bearer access"
      );
      return Response.json({ items: [] });
    }
    return new Response("Not found", { status: 404 });
  },
});
afterAll(() => server.stop());
const file = join(
  directory,
  "teak",
  `credentials-${createHash("sha256").update(server.url.origin).digest("hex")}.json`
);
const childEnv = () => ({
  ...env,
  PATH: `${directory}:${env.PATH}`,
  XDG_CONFIG_HOME: directory,
  TEAK_API_URL: server.url.origin,
  TEAK_API_KEY: "",
  TEAK_AUTH_URL: "",
});
const run = async (args: string[]) => {
  const child = spawn(
    [process.execPath, "--no-env-file", "run", "src/index.ts", ...args],
    {
      cwd: new URL("..", import.meta.url).pathname,
      env: childEnv(),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    }
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
};
const login = async (
  flip = false,
  invalidState = false,
  signoutBeforeCallback = false,
  unsafeLock = false
) => {
  const child = spawn(
    [
      process.execPath,
      "--no-env-file",
      "run",
      "src/index.ts",
      "login",
      "--no-browser",
    ],
    {
      cwd: new URL("..", import.meta.url).pathname,
      env: childEnv(),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    }
  );
  const reader = child.stdout.getReader();
  let stdout = "";
  while (!stdout.includes("\n")) {
    const chunk = await reader.read();
    if (chunk.done) {
      throw new Error("Missing authorization URL");
    }
    stdout += new TextDecoder().decode(chunk.value);
  }
  const authorization = new URL(stdout.split("\n")[0]!);
  expect(authorization.pathname).toBe(`/${environment}/oauth2/authorize`);
  expect(authorization.searchParams.get("client_id")).toBe(
    clients().cli ?? null
  );
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorization.searchParams.get("scope")).toBe(
    "openid profile email offline_access"
  );
  expect(authorization.searchParams.get("resource")).toBe(
    "https://teakvault.com/api"
  );
  const callback = new URL(authorization.searchParams.get("redirect_uri")!);
  if (signoutBeforeCallback) {
    expect((await run(["logout"])).code).toBe(0);
  }
  if (moveTokenEndpoint) {
    tokenPath = "/moved-token";
  }
  if (invalidState) {
    callback.searchParams.set(
      "state",
      "é".repeat(authorization.searchParams.get("state")!.length)
    );
    expect((await fetch(callback)).status).toBe(400);
  }
  if (flip) {
    environment = environment === "alpha" ? "beta" : "alpha";
  }
  callback.searchParams.set("state", authorization.searchParams.get("state")!);
  callback.searchParams.set("code", "code");
  if (unsafeLock) {
    writeFileSync(file.replace(/\.json$/, ".lock"), "unsafe");
  }
  const response = await fetch(callback);
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    stdout += new TextDecoder().decode(chunk.value);
  }
  return {
    code: await child.exited,
    callbackStatus: response.status,
    stdout,
    stderr: await new Response(child.stderr).text(),
  };
};
beforeEach(() => {
  environment = "alpha";
  tokenStatus = 200;
  tokenBody = undefined;
  refreshes = 0;
  exchanges = 0;
  disconnects = 0;
  applicationRevoked = false;
  rejectRefreshReplay = false;
  apiRequests = 0;
  holdFirstApi = false;
  rotateAccessToken = false;
  apiStarted = new Promise((resolve) => {
    notifyApiStarted = resolve;
  });
  apiReleased = new Promise((resolve) => {
    releaseApi = resolve;
  });
  transmitted = null;
  unsafeTokenEndpoint = undefined;
  tokenPath = "/oauth2/token";
  moveTokenEndpoint = false;
  metadataIssuerOrigin = undefined;
  discoveryRequests = 0;
  writeFileSync(file, "", { mode: 0o600 });
});
test("CLI signs in with WorkOS and disconnects on logout", async () => {
  const result = await login();
  expect(result.code).toBe(0);
  expect(result.callbackStatus).toBe(200);
  expect(JSON.parse(readFileSync(file, "utf8")).binding).toEqual({
    apiUrl: server.url.origin,
    issuer: `${server.url.origin}/alpha`,
    clientId: "client_01ALPHACLI",
    ownerId: "verified-owner",
  });
  expect((await run(["auth", "status", "--json"])).code).toBe(0);
  expect((await run(["logout"])).code).toBe(0);
  expect(disconnects).toBe(1);
  expect(readFileSync(file, "utf8")).toBe("");
});
test.each([
  ["unbound", undefined],
  [
    "Better Auth bound",
    {
      issuer: "https://app.teakvault.com",
      clientId: "teak-cli",
      revocationEndpoint: "https://teakvault.com/api/api/oauth/revoke",
    },
  ],
])(
  "CLI never uses %s pre-WorkOS credentials and replaces them on sign-in",
  async (_name, binding) => {
    const legacy = JSON.stringify({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3_600_000,
      ...(binding
        ? { binding: { apiUrl: server.url.origin, ...binding } }
        : {}),
    });
    writeFileSync(file, legacy);
    expect((await run(["auth", "status"])).code).toBe(3);
    expect(apiRequests).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(legacy);
    expect((await login()).code).toBe(0);
    expect(disconnects).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).binding.clientId).toBe(
      "client_01ALPHACLI"
    );
  }
);
test.if(platform() === "darwin")(
  "CLI hands tokens to the Keychain over stdin, never as arguments",
  async () => {
    const args = join(directory, "security-args");
    const input = join(directory, "security-input");
    writeFileSync(
      join(directory, "security"),
      `#!/bin/sh\nif [ "$1" = "-i" ]; then echo "$@" >> "${args}"; cat >> "${input}"; fi\nexit 1\n`,
      { mode: 0o700 }
    );
    try {
      expect((await login()).code).toBe(0);
      const saved = JSON.parse(readFileSync(file, "utf8"));
      expect(readFileSync(args, "utf8").trim()).toBe("-i");
      const command = readFileSync(input, "utf8").trim();
      expect(command).not.toContain(saved.accessToken);
      const hex = command.match(/ -X ([0-9a-f]+)$/)?.[1] ?? "";
      expect(
        JSON.parse(Buffer.from(hex, "hex").toString("utf8"))
      ).toMatchObject({
        accessToken: saved.accessToken,
        refreshToken: saved.refreshToken,
      });
    } finally {
      writeFileSync(join(directory, "security"), "#!/bin/sh\nexit 1\n", {
        mode: 0o700,
      });
    }
  }
);
test("CLI rejects a client registration change during browser login without exchanging the old code", async () => {
  const result = await login(true);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Authentication changed");
  expect(exchanges).toBe(0);
  expect(readFileSync(file, "utf8")).toBe("");
});
test("CLI rejects Unicode callback state and still accepts the valid callback", async () => {
  expect((await login(false, true)).code).toBe(0);
  expect(exchanges).toBe(1);
});
test("CLI keeps credentials from a previous client registration unused until logout", async () => {
  expect((await login()).code).toBe(0);
  const saved = readFileSync(file, "utf8");
  environment = "beta";
  const result = await run(["auth", "status", "--json"]);
  expect(result.code).toBe(3);
  expect(refreshes).toBe(0);
  expect(apiRequests).toBe(0);
  expect(readFileSync(file, "utf8")).toBe(saved);
  expect((await run(["logout"])).code).toBe(0);
  expect(disconnects).toBe(1);
  expect(readFileSync(file, "utf8")).toBe("");
});
test("CLI rotates expired credentials once for concurrent API requests", async () => {
  expect((await login()).code).toBe(0);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.expiresAt = 0;
  writeFileSync(file, JSON.stringify(saved));
  const script =
    'const {client}=await import("./src/runtime.ts");const c=client({});await Promise.all([c.tags.list(),c.tags.list()]);';
  const child = spawn([process.execPath, "--no-env-file", "-e", script], {
    cwd: new URL("..", import.meta.url).pathname,
    env: childEnv(),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  const error = await new Response(child.stderr).text();
  expect(error).toBe("");
  expect(await child.exited).toBe(0);
  expect(refreshes).toBe(1);
  expect(JSON.parse(readFileSync(file, "utf8")).refreshToken).toBe("refresh-1");
  expect(transmitted?.get("resource")).toBe("https://teakvault.com/api");
});
test("CLI preserves expired refresh credentials across a service outage", async () => {
  expect((await login()).code).toBe(0);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.expiresAt = 0;
  writeFileSync(file, JSON.stringify(saved));
  tokenStatus = 503;
  expect((await run(["auth", "status"])).code).toBe(3);
  expect(JSON.parse(readFileSync(file, "utf8")).refreshToken).toBe(
    saved.refreshToken
  );
  tokenStatus = 200;
  expect((await run(["auth", "status"])).code).toBe(0);
});

test("CLI discovers the auth server once when it refreshes expired credentials", async () => {
  expect((await login()).code).toBe(0);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.expiresAt = 0;
  writeFileSync(file, JSON.stringify(saved));
  discoveryRequests = 0;
  const script =
    'const {client}=await import("./src/runtime.ts");await client({}).tags.list();';
  const child = spawn([process.execPath, "--no-env-file", "-e", script], {
    cwd: new URL("..", import.meta.url).pathname,
    env: childEnv(),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  expect(await child.exited).toBe(0);
  expect(refreshes).toBe(1);
  expect(apiRequests).toBe(1);
  // Resource, client registry and issuer metadata, fetched once.
  expect(discoveryRequests).toBe(3);
  expect(JSON.parse(readFileSync(file, "utf8")).refreshToken).toBe("refresh-1");
});

test("CLI uses fresh token metadata when an endpoint moves during browser sign-in", async () => {
  moveTokenEndpoint = true;
  expect((await login()).code).toBe(0);
  expect(exchanges).toBe(1);
});

test("CLI clears a revoked refresh token and asks for a new sign-in", async () => {
  expect((await login()).code).toBe(0);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.expiresAt = 0;
  writeFileSync(file, JSON.stringify(saved));
  tokenStatus = 400;
  tokenBody = { error: "invalid_grant" };
  const result = await run(["auth", "status"]);
  expect(result.code).toBe(3);
  expect(result.stderr).toContain("teak login");
  expect(readFileSync(file, "utf8")).toBe("");
});

test.each([
  "https://169.254.169.254/token",
  "http://untrusted.example/token",
  "https://user:password@untrusted.example/token",
])(
  "CLI rejects unsafe token metadata before sending credentials (%s)",
  async (endpoint) => {
    expect((await login()).code).toBe(0);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    saved.expiresAt = 0;
    const credentials = JSON.stringify(saved);
    writeFileSync(file, credentials);
    unsafeTokenEndpoint = endpoint;
    const result = await run(["tags"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unsafe OAuth discovery URL");
    expect(refreshes).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(credentials);
  }
);

test.each([
  '"wrong"',
  '{"accessToken":"access","expiresAt":"never"}',
  '{"accessToken":"access","binding":true}',
])("CLI ignores corrupt cached credentials (%s)", async (corrupt) => {
  writeFileSync(file, corrupt);
  expect((await run(["auth", "status"])).code).toBe(3);
  expect(exchanges).toBe(0);
  expect(refreshes).toBe(0);
});
test("CLI local development never uses or clears the legacy production credential file", async () => {
  const legacyFile = join(directory, "teak", "credentials.json");
  const legacy = JSON.stringify({
    accessToken: "production",
    refreshToken: "production-refresh",
    expiresAt: Date.now() + 3_600_000,
  });
  writeFileSync(legacyFile, legacy);
  expect((await run(["auth", "status"])).code).toBe(3);
  expect(readFileSync(legacyFile, "utf8")).toBe(legacy);
  expect(exchanges).toBe(0);
  expect(refreshes).toBe(0);
});
test("CLI falls back to the registered second loopback port without keeping the first timeout alive", async () => {
  let occupied: ReturnType<typeof serve> | undefined;
  try {
    occupied = serve({
      hostname: "127.0.0.1",
      port: 14_210,
      fetch: () => new Response("occupied"),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
      throw error;
    }
  }
  try {
    expect((await login()).code).toBe(0);
    expect(exchanges).toBe(1);
  } finally {
    occupied?.stop();
  }
});

test("CLI coordinates expired refreshes across separate processes", async () => {
  rejectRefreshReplay = true;
  expect((await login()).code).toBe(0);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.expiresAt = 0;
  writeFileSync(file, JSON.stringify(saved));
  const results = await Promise.all([run(["tags"]), run(["tags"])]);
  expect(results.map((result) => result.code)).toEqual([0, 0]);
  expect(refreshes).toBe(1);
  expect(JSON.parse(readFileSync(file, "utf8")).refreshToken).toBe("refresh-1");
});
test("CLI supports an explicit .localhost issuer with a hosted development API", async () => {
  const apiUrl = `https://${crypto.randomUUID()}.example`;
  const issuerOrigin = "http://app.localhost:3000";
  metadataIssuerOrigin = issuerOrigin;
  const options = { apiUrl, authUrl: `${issuerOrigin}/alpha` };
  const credentials = join(
    directory,
    "teak",
    `credentials-${createHash("sha256").update(apiUrl).digest("hex")}.json`
  );
  writeFileSync(
    credentials,
    JSON.stringify({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3_600_000,
      binding: { apiUrl, issuer: options.authUrl, clientId: clients().cli },
    })
  );
  const originalFetch = globalThis.fetch;
  const originalConfig = env.XDG_CONFIG_HOME;
  const originalPath = env.PATH;
  try {
    env.XDG_CONFIG_HOME = directory;
    env.PATH = `${directory}:${originalPath}`;
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      expect([apiUrl, issuerOrigin]).toContain(url.origin);
      return await originalFetch(
        new URL(url.pathname + url.search, server.url),
        init
      );
    }) as typeof fetch;
    const { client } = await import("./runtime");
    expect(await client(options).tags.list()).toEqual({ items: [] });
    expect(apiRequests).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalConfig === undefined) {
      Reflect.deleteProperty(env, "XDG_CONFIG_HOME");
    } else {
      env.XDG_CONFIG_HOME = originalConfig;
    }
    env.PATH = originalPath;
  }
});

test("CLI does not refresh a newer credential because an older API response returns 401", async () => {
  expect((await login()).code).toBe(0);
  holdFirstApi = true;
  rejectRefreshReplay = true;
  const first = run(["tags"]);
  try {
    await apiStarted;
    const saved = JSON.parse(readFileSync(file, "utf8"));
    saved.expiresAt = 0;
    writeFileSync(file, JSON.stringify(saved));
    expect((await run(["tags"])).code).toBe(0);
  } finally {
    releaseApi();
  }
  expect((await first).code).toBe(0);
  expect(refreshes).toBe(1);
  expect(JSON.parse(readFileSync(file, "utf8")).refreshToken).toBe("refresh-1");
});
test("CLI logout cancels a pending login in another process and discards its late grant", async () => {
  const result = await login(false, false, true);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("cancelled by logout");
  expect(disconnects).toBe(0);
  expect(readFileSync(file, "utf8")).toBe("");
});

test("CLI reconnect disconnects a previous client registration before replacing it", async () => {
  expect((await login()).code).toBe(0);
  environment = "beta";
  expect((await login()).code).toBe(0);
  expect(disconnects).toBe(1);
  expect(JSON.parse(readFileSync(file, "utf8")).binding.issuer).toBe(
    `${server.url.origin}/beta`
  );
});

test("CLI reuses a same-client refresh when an older concurrent request returns 401", async () => {
  rotateAccessToken = true;
  expect((await login()).code).toBe(0);
  holdFirstApi = true;
  const originalConfig = env.XDG_CONFIG_HOME;
  const originalPath = env.PATH;
  const originalKey = env.TEAK_API_KEY;
  try {
    env.XDG_CONFIG_HOME = directory;
    env.PATH = `${directory}:${originalPath}`;
    env.TEAK_API_KEY = "";
    const { client } = await import("./runtime");
    const api = client({ apiUrl: server.url.origin });
    const first = api.tags.list();
    await apiStarted;
    const saved = JSON.parse(readFileSync(file, "utf8"));
    saved.expiresAt = 0;
    writeFileSync(file, JSON.stringify(saved));
    expect(await api.tags.list()).toEqual({ items: [] });
    // A second refresh must not be needed, even when the provider is down.
    tokenStatus = 503;
    releaseApi();
    expect(await first).toEqual({ items: [] });
    expect(refreshes).toBe(1);
  } finally {
    releaseApi();
    for (const [key, value] of Object.entries({
      XDG_CONFIG_HOME: originalConfig,
      PATH: originalPath,
      TEAK_API_KEY: originalKey,
    })) {
      if (value === undefined) {
        Reflect.deleteProperty(env, key);
      } else {
        env[key] = value;
      }
    }
  }
});

test("CLI refreshes a rejected token after joining an overlapping ordinary read", async () => {
  expect((await login()).code).toBe(0);
  const previous = {
    XDG_CONFIG_HOME: env.XDG_CONFIG_HOME,
    PATH: env.PATH,
    TEAK_API_KEY: env.TEAK_API_KEY,
  };
  const originalFetch = globalThis.fetch;
  let releaseMetadata = () => {};
  const metadataGate = new Promise<void>((resolve) => {
    releaseMetadata = resolve;
  });
  let notifyMetadata = () => {};
  const metadataStarted = new Promise<void>((resolve) => {
    notifyMetadata = resolve;
  });
  let overlapping: Promise<unknown> | undefined;
  try {
    env.XDG_CONFIG_HOME = directory;
    env.PATH = `${directory}:${previous.PATH}`;
    env.TEAK_API_KEY = "";
    const { client } = await import("./runtime");
    let api: ReturnType<typeof client>;
    let firstApi = true;
    globalThis.fetch = (async (input, init) => {
      const response = await originalFetch(input, init);
      if (String(input).endsWith("/v1/tags") && firstApi) {
        firstApi = false;
        // A new transport instance gives the overlapping read uncached metadata.
        globalThis.fetch = (async (next, nextInit) => {
          if (String(next).includes("/.well-known/")) {
            notifyMetadata();
            await metadataGate;
          }
          return await originalFetch(next, nextInit);
        }) as typeof fetch;
        overlapping = api.tags.list();
        await metadataStarted;
        class RejectedResponse extends Response {
          override get status() {
            queueMicrotask(releaseMetadata);
            return 401;
          }
        }
        return new RejectedResponse(
          JSON.stringify({ error: "Rejected token" })
        );
      }
      return response;
    }) as typeof fetch;
    api = client({ apiUrl: server.url.origin });
    expect(await api.tags.list()).toEqual({ items: [] });
    expect(await overlapping).toEqual({ items: [] });
    expect(refreshes).toBe(1);
  } finally {
    releaseMetadata();
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        Reflect.deleteProperty(env, key);
      } else {
        env[key] = value;
      }
    }
  }
});

test("CLI discards a new grant if unsafe storage prevents acquiring its commit lock", async () => {
  const lock = file.replace(/\.json$/, ".lock");
  try {
    const result = await login(false, false, false, true);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unsafe credential lock");
    expect(exchanges).toBe(1);
    expect(disconnects).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("");
  } finally {
    unlinkSync(lock);
  }
});

test("verified same-owner WorkOS reconnect keeps the new application grant usable", async () => {
  expect((await login()).code).toBe(0);
  expect(JSON.parse(readFileSync(file, "utf8")).binding.ownerId).toBe(
    "verified-owner"
  );
  expect((await login()).code).toBe(0);
  expect(disconnects).toBe(0);
  expect((await run(["tags", "list"])).code).toBe(0);
});
test("unknown-owner saved WorkOS login stops before issuing another grant", async () => {
  expect((await login()).code).toBe(0);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.binding.ownerId = undefined;
  writeFileSync(file, JSON.stringify(saved));
  const before = exchanges;
  const result = await run(["login", "--no-browser"]);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("logout");
  expect(exchanges).toBe(before);
});
