import { afterAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, serve, spawn } from "bun";

// The real CLI, callback server, discovery helper and SDK run in isolated child
// processes. Only the authorization server/API and OS credential store are fake.
const directory = mkdtempSync(join(tmpdir(), "teak-discovery-"));
mkdirSync(join(directory, "teak"));
writeFileSync(join(directory, "security"), "#!/bin/sh\nexit 1\n", {
  mode: 0o700,
});
let primary: "betterauth" | "workos" = "betterauth";
let tokenStatus = 200;
let tokenBody: Record<string, unknown> | undefined;
let refreshes = 0;
let exchanges = 0;
let revoked = 0;
let flipDuringRefresh = false;
let notifyStarted = () => {};
let releaseRefresh = () => {};
let started: Promise<void>;
let released: Promise<void>;
let transmitted: URLSearchParams | null = null;
let unsafeEndpoint: string | undefined;
let unsafeField: "token_endpoint" | "revocation_endpoint" = "token_endpoint";
let tokenPath = "/token";
let moveTokenEndpoint = false;
const clients = () =>
  Object.fromEntries(
    ["cli", "raycast", "chrome", "firefox", "safari"].map((surface) => [
      surface,
      `${primary === "workos" ? "client" : "teak"}-${surface}`,
    ])
  );
const server = serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const issuer = `${server.url.origin}/${primary}`;
    if (url.pathname === "/test/refresh-started") {
      await started;
      return new Response("ready");
    }
    if (url.pathname === "/test/release-refresh") {
      releaseRefresh();
      return new Response("released");
    }
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      return Response.json({
        resource: `${server.url.origin}/mcp`,
        authorization_servers: [issuer],
      });
    }
    if (url.pathname === "/.well-known/teak-oauth-clients.json") {
      return Response.json({ primary, issuer, clients: clients() });
    }
    if (url.pathname === `/.well-known/oauth-authorization-server/${primary}`) {
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}${tokenPath}`,
        revocation_endpoint: `${issuer}/revoke`,
        code_challenge_methods_supported: ["S256"],
        ...(unsafeEndpoint ? { [unsafeField]: unsafeEndpoint } : {}),
      });
    }
    if (url.pathname === `/${primary}${tokenPath}`) {
      const body = new URLSearchParams(await request.text());
      transmitted = body;
      expect(body.get("client_id")).toBe(clients().cli ?? null);
      expect(body.get("resource")).toBe(
        primary === "workos" ? `${server.url.origin}/api` : null
      );
      if (body.get("grant_type") === "refresh_token") {
        refreshes++;
        if (flipDuringRefresh) {
          primary = "betterauth";
          notifyStarted();
          await released;
        }
      } else {
        exchanges++;
        expect(body.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);
      }
      return Response.json(
        tokenBody ?? {
          access_token: "access",
          refresh_token: `refresh-${refreshes}`,
          expires_in: 3600,
        },
        { status: tokenStatus }
      );
    }
    if (url.pathname === `/${primary}/revoke`) {
      revoked++;
      return new Response(null, { status: 200 });
    }
    if (url.pathname === "/v1/tags") {
      expect(request.headers.get("authorization")).toBe("Bearer access");
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
const login = async (flip = false, invalidState = false) => {
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
  expect(authorization.pathname).toBe(`/${primary}/authorize`);
  expect(authorization.searchParams.get("client_id")).toBe(
    clients().cli ?? null
  );
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorization.searchParams.get("scope")).toContain("offline_access");
  expect(authorization.searchParams.get("resource")).toBe(
    primary === "workos" ? `${server.url.origin}/api` : null
  );
  const callback = new URL(authorization.searchParams.get("redirect_uri")!);
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
    primary = primary === "workos" ? "betterauth" : "workos";
  }
  callback.searchParams.set("state", authorization.searchParams.get("state")!);
  callback.searchParams.set("code", "code");
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
  primary = "betterauth";
  tokenStatus = 200;
  tokenBody = undefined;
  refreshes = 0;
  exchanges = 0;
  revoked = 0;
  transmitted = null;
  unsafeEndpoint = undefined;
  tokenPath = "/token";
  moveTokenEndpoint = false;
  flipDuringRefresh = false;
  started = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  released = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  writeFileSync(file, "", { mode: 0o600 });
});
test.each(["betterauth", "workos"] as const)(
  "CLI signs in and disconnects using %s discovery",
  async (mode) => {
    primary = mode;
    const result = await login();
    expect(result.code).toBe(0);
    expect(result.callbackStatus).toBe(200);
    expect(JSON.parse(readFileSync(file, "utf8")).binding.issuer).toBe(
      `${server.url.origin}/${primary}`
    );
    expect((await run(["auth", "status", "--json"])).code).toBe(0);
    expect((await run(["logout"])).code).toBe(0);
    expect(revoked).toBe(1);
    expect(readFileSync(file, "utf8")).toBe("");
  }
);
test("CLI rejects a provider flip during browser login without exchanging the old code", async () => {
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
test("CLI discards a previous provider's credentials before calling the new token endpoint", async () => {
  expect((await login()).code).toBe(0);
  primary = "workos";
  const result = await run(["auth", "status", "--json"]);
  expect(result.code).toBe(3);
  expect(refreshes).toBe(0);
  expect(readFileSync(file, "utf8")).toBe("");
});
test("CLI rotates expired credentials once for concurrent API requests", async () => {
  primary = "workos";
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
  expect(transmitted?.get("resource")).toBe(`${server.url.origin}/api`);
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

test("CLI does not resurrect an in-flight refresh after another request observes a provider flip", async () => {
  primary = "workos";
  expect((await login()).code).toBe(0);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.expiresAt = 0;
  writeFileSync(file, JSON.stringify(saved));
  flipDuringRefresh = true;
  const script =
    'const {client}=await import("./src/runtime.ts");const c=client({});const first=c.tags.list().catch(()=>null);await fetch(process.env.TEAK_API_URL+"/test/refresh-started");const now=Date.now;Date.now=()=>now()+61000;await c.tags.list().catch(()=>null);await fetch(process.env.TEAK_API_URL+"/test/release-refresh");await first;';
  const child = spawn([process.execPath, "--no-env-file", "-e", script], {
    cwd: new URL("..", import.meta.url).pathname,
    env: childEnv(),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  expect(await child.exited).toBe(0);
  expect(refreshes).toBe(1);
  expect(readFileSync(file, "utf8")).toBe("");
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
])("CLI rejects unsafe token metadata before sending credentials (%s)", async (endpoint) => {
  expect((await login()).code).toBe(0);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.expiresAt = 0;
  const credentials = JSON.stringify(saved);
  writeFileSync(file, credentials);
  unsafeField = "token_endpoint";
  unsafeEndpoint = endpoint;
  const result = await run(["tags"]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Unsafe OAuth discovery URL");
  expect(refreshes).toBe(0);
  expect(readFileSync(file, "utf8")).toBe(credentials);
});

test("CLI rejects private revocation metadata and keeps credentials for retry", async () => {
  expect((await login()).code).toBe(0);
  const credentials = readFileSync(file, "utf8");
  unsafeField = "revocation_endpoint";
  unsafeEndpoint = "https://169.254.169.254/revoke";
  expect((await run(["logout"])).code).toBe(1);
  expect(revoked).toBe(0);
  expect(readFileSync(file, "utf8")).toBe(credentials);
});

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
  const occupied = serve({
    hostname: "127.0.0.1",
    port: 14_210,
    fetch: () => new Response("occupied"),
  });
  try {
    expect((await login()).code).toBe(0);
    expect(exchanges).toBe(1);
  } finally {
    occupied.stop();
  }
});
