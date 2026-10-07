import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { serve, spawn } from "bun";

// Real CLI process and HTTP server: provider metadata omits revocation as
// WorkOS does. Confirmed disconnect clears credentials; any other response
// preserves them. Expired saved access is presented without interactive login.
const directory = mkdtempSync(join(tmpdir(), "teak-connect-logout-"));
mkdirSync(join(directory, "teak"));
writeFileSync(join(directory, "security"), "#!/bin/sh\nexit 1\n", {
  mode: 0o700,
});
let responseStatus = 204;
let disconnects = 0;
let refreshes = 0;
let refreshAllowed = false;
let refreshFailure: { status: number; body: string } | null = null;
let refreshedDisconnectStatus = 204;
const server = serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/v1/oauth/disconnect") {
      expect(request.method).toBe("POST");
      const renewed =
        request.headers.get("authorization") === "Bearer renewed-access";
      expect(request.headers.get("authorization")).toBe(
        renewed ? "Bearer renewed-access" : "Bearer signed-access"
      );
      expect(await request.text()).toBe("");
      disconnects++;
      return new Response(null, {
        status: renewed ? refreshedDisconnectStatus : responseStatus,
        ...(responseStatus === 302
          ? { headers: { Location: `${server.url.origin}/exfiltrate` } }
          : {}),
      });
    }
    if (url.pathname === "/oauth2/token") {
      refreshes++;
      const body = new URLSearchParams(await request.text());
      expect(body.get("client_id")).toBe("client_cli");
      expect(body.get("refresh_token")).toBe("saved-refresh");
      expect(body.get("resource")).toBe("https://teakvault.com/api");
      if (refreshFailure) {
        return new Response(refreshFailure.body, {
          status: refreshFailure.status,
        });
      }
      return refreshAllowed
        ? Response.json({
            access_token: "renewed-access",
            refresh_token: "renewed-refresh",
            expires_in: 300,
          })
        : new Response(null, { status: 503 });
    }
    if (url.pathname.endsWith("oauth-protected-resource/mcp")) {
      return Response.json({
        resource: "https://teakvault.com/mcp",
        authorization_servers: [server.url.origin],
      });
    }
    if (url.pathname.endsWith("teak-oauth-clients.json")) {
      return Response.json({
        primary: "workos",
        issuer: server.url.origin,
        clients: Object.fromEntries(
          ["cli", "raycast", "chrome", "firefox", "safari"].map((name) => [
            name,
            `client_${name}`,
          ])
        ),
      });
    }
    if (url.pathname.endsWith("oauth-authorization-server")) {
      return Response.json({
        issuer: server.url.origin,
        authorization_endpoint: `${server.url.origin}/authorize`,
        token_endpoint: `${server.url.origin}/oauth2/token`,
        code_challenge_methods_supported: ["S256"],
      });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  },
});
afterAll(() => server.stop());
test.each([204, 200, 302, 401, 503])(
  "WorkOS CLI disconnect requires confirmed 204 (%i)",
  async (status) => {
    responseStatus = status;
    const file = join(
      directory,
      "teak",
      `credentials-${createHash("sha256").update(server.url.origin).digest("hex")}.json`
    );
    const original = JSON.stringify({
      accessToken: "signed-access",
      refreshToken: "saved-refresh",
      expiresAt: 0,
      binding: {
        apiUrl: server.url.origin,
        issuer: server.url.origin,
        clientId: "client_cli",
      },
    });
    writeFileSync(file, original, { mode: 0o600 });
    const before = disconnects;
    const child = spawn([process.execPath, "run", "src/index.ts", "logout"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        XDG_CONFIG_HOME: directory,
        TEAK_API_URL: server.url.origin,
        TEAK_AUTH_URL: server.url.origin,
        TEAK_API_KEY: "unused-api-key",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await child.exited;
    const output = await new Response(child.stderr).text();
    expect(disconnects - before).toBe(1);
    if (status === 204) {
      expect(code).toBe(0);
      expect(readFileSync(file, "utf8")).toBe("");
    } else {
      expect(code).not.toBe(0);
      expect(output).toContain("credentials are still saved");
      expect(readFileSync(file, "utf8")).toBe(original);
    }
  }
);

test.each([204, 503])(
  "expired first logout refreshes once and preserves rotation on retry failure (%i)",
  async (status) => {
    responseStatus = 401;
    refreshAllowed = true;
    refreshedDisconnectStatus = status;
    const file = join(
      directory,
      "teak",
      `credentials-${createHash("sha256").update(server.url.origin).digest("hex")}.json`
    );
    writeFileSync(
      file,
      JSON.stringify({
        accessToken: "signed-access",
        refreshToken: "saved-refresh",
        expiresAt: 0,
        binding: {
          apiUrl: server.url.origin,
          issuer: server.url.origin,
          clientId: "client_cli",
        },
      }),
      { mode: 0o600 }
    );
    const before = refreshes;
    const child = spawn([process.execPath, "run", "src/index.ts", "logout"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        XDG_CONFIG_HOME: directory,
        TEAK_API_URL: server.url.origin,
        TEAK_AUTH_URL: server.url.origin,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(status === 204 ? 0 : 1);
    expect(refreshes - before).toBe(1);
    expect(
      status === 204
        ? readFileSync(file, "utf8")
        : JSON.parse(readFileSync(file, "utf8")).refreshToken
    ).toBe(status === 204 ? "" : "renewed-refresh");
    refreshAllowed = false;
  }
);

test.each([0, 1])(
  "Keychain write status %i retains the authoritative rotated credential across logout retries",
  async (writeStatus) => {
    const stale = join(directory, "stale-keychain.json");
    const file = join(
      directory,
      "teak",
      `credentials-${createHash("sha256").update(server.url.origin).digest("hex")}.json`
    );
    const original = {
      accessToken: "signed-access",
      refreshToken: "saved-refresh",
      expiresAt: 0,
      binding: {
        apiUrl: server.url.origin,
        issuer: server.url.origin,
        clientId: "client_cli",
      },
    };
    writeFileSync(stale, JSON.stringify(original), { mode: 0o600 });
    const saved = { ...original, fallbackAuthority: writeStatus === 0 };
    if (writeStatus === 1 && platform() === "darwin") {
      saved.accessToken = "stale-unmarked-file";
    }
    writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
    writeFileSync(
      join(directory, "security"),
      '#!/bin/sh\nif [ "$1" = "find-generic-password" ]; then cat "$TEAK_TEST_KEYCHAIN_FILE"; exit 0; fi\nexit ' +
        writeStatus +
        "\n",
      { mode: 0o700 }
    );
    const run = async () => {
      const child = spawn([process.execPath, "run", "src/index.ts", "logout"], {
        cwd: new URL("..", import.meta.url).pathname,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          XDG_CONFIG_HOME: directory,
          TEAK_API_URL: server.url.origin,
          TEAK_AUTH_URL: server.url.origin,
          TEAK_TEST_KEYCHAIN_FILE: stale,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      return await child.exited;
    };
    try {
      responseStatus = 401;
      refreshAllowed = true;
      refreshedDisconnectStatus = 503;
      const before = refreshes;
      expect(await run()).toBe(1);
      expect(JSON.parse(readFileSync(file, "utf8")).refreshToken).toBe(
        "renewed-refresh"
      );
      refreshedDisconnectStatus = 204;
      expect(await run()).toBe(0);
      expect(refreshes - before).toBe(1);
    } finally {
      refreshAllowed = false;
      writeFileSync(join(directory, "security"), "#!/bin/sh\nexit 1\n", {
        mode: 0o700,
      });
    }
  }
);

test.each([
  [400, '{"error":"invalid_grant"}', true],
  [401, '{"error":"invalid_refresh_token"}', true],
  [401, '{"error":"invalid_client"}', false],
  [401, "", false],
  [400, "not-json", false],
  [503, '{"error":"invalid_grant"}', false],
] as const)(
  "dead logout refresh HTTP%i clears only proven invalid grants",
  async (status, body, clear) => {
    responseStatus = 401;
    refreshFailure = { status, body };
    const file = join(
      directory,
      "teak",
      `credentials-${createHash("sha256").update(server.url.origin).digest("hex")}.json`
    );
    const original = JSON.stringify({
      accessToken: "signed-access",
      refreshToken: "saved-refresh",
      expiresAt: 0,
      binding: {
        apiUrl: server.url.origin,
        issuer: server.url.origin,
        clientId: "client_cli",
      },
    });
    writeFileSync(file, original, { mode: 0o600 });
    const before = disconnects;
    try {
      const child = spawn([process.execPath, "run", "src/index.ts", "logout"], {
        cwd: new URL("..", import.meta.url).pathname,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          XDG_CONFIG_HOME: directory,
          TEAK_API_URL: server.url.origin,
          TEAK_AUTH_URL: server.url.origin,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await child.exited).toBe(clear ? 0 : 1);
      expect(readFileSync(file, "utf8")).toBe(clear ? "" : original);
      expect(disconnects - before).toBe(1);
      if (clear) {
        expect(await new Response(child.stdout).text()).toContain(
          "other installations"
        );
      }
    } finally {
      refreshFailure = null;
    }
  }
);
