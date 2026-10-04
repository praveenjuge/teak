import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, serve, spawn } from "bun";

const directory = mkdtempSync(join(tmpdir(), "teak-logout-"));
mkdirSync(join(directory, "teak"));
writeFileSync(join(directory, "security"), "#!/bin/sh\nexit 1\n", {
  mode: 0o700,
});
const credentialsPath = () =>
  join(
    directory,
    "teak",
    `credentials-${createHash("sha256").update(server.url.origin).digest("hex")}.json`
  );
const binding = () => ({
  apiUrl: server.url.origin,
  issuer: server.url.origin,
  clientId: "teak-cli",
});
let responseStatus = 200;
let received: URLSearchParams | null = null;
const server = serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      return Response.json({
        resource: `${server.url.origin}/mcp`,
        authorization_servers: [server.url.origin],
      });
    }
    if (url.pathname === "/.well-known/teak-oauth-clients.json") {
      return Response.json({
        primary: "betterauth",
        issuer: server.url.origin,
        clients: {
          cli: "teak-cli",
          raycast: "teak-raycast",
          chrome: "teak-chrome",
          firefox: "teak-firefox",
          safari: "teak-safari",
        },
      });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return Response.json({
        issuer: server.url.origin,
        authorization_endpoint: `${server.url.origin}/authorize`,
        token_endpoint: `${server.url.origin}/token`,
        revocation_endpoint: `${server.url.origin}/revoke`,
        code_challenge_methods_supported: ["S256"],
      });
    }
    expect(url.pathname).toBe("/revoke");
    expect(request.method).toBe("POST");
    received = new URLSearchParams(await request.text());
    return new Response(null, { status: responseStatus });
  },
});
afterAll(() => server.stop());

const runLogout = async (authUrl = server.url.toString()) => {
  const child = spawn([process.execPath, "run", "src/index.ts", "logout"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...env,
      PATH: `${directory}:${env.PATH}`,
      XDG_CONFIG_HOME: directory,
      TEAK_API_URL: authUrl,
      TEAK_API_KEY: "api-key-must-not-be-revoked",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: await child.exited,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
};

describe("CLI logout", () => {
  test("revokes this installation before clearing local credentials", async () => {
    writeFileSync(
      credentialsPath(),
      JSON.stringify({
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 0,
        binding: binding(),
      })
    );
    const result = await runLogout();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Logged out");
    expect(received?.get("client_id")).toBe("teak-cli");
    expect(received?.get("token")).toBe("refresh");
    expect(readFileSync(credentialsPath(), "utf8")).toBe("");
  });

  test("keeps credentials for retry after a server failure", async () => {
    const credentials = JSON.stringify({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 0,
      binding: binding(),
    });
    writeFileSync(credentialsPath(), credentials);
    responseStatus = 503;
    const result = await runLogout();
    responseStatus = 200;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("run teak logout again");
    expect(readFileSync(credentialsPath(), "utf8")).toBe(credentials);
  });

  test("keeps credentials for retry when offline", async () => {
    const credentials = JSON.stringify({
      accessToken: "offline-access",
      refreshToken: "offline-refresh",
      expiresAt: 0,
      binding: {
        apiUrl: "http://127.0.0.1:1",
        issuer: "http://127.0.0.1:1",
        clientId: "teak-cli",
      },
    });
    const otherPath = join(
      directory,
      "teak",
      `credentials-${createHash("sha256").update("http://127.0.0.1:1").digest("hex")}.json`
    );
    writeFileSync(otherPath, credentials);
    const result = await runLogout("http://127.0.0.1:1");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("credentials are still saved");
    expect(readFileSync(otherPath, "utf8")).toBe(credentials);
  });

  test("supports access-token-only and already disconnected sessions", async () => {
    writeFileSync(
      credentialsPath(),
      JSON.stringify({ accessToken: "access", binding: binding() })
    );
    expect((await runLogout()).code).toBe(0);
    expect(received?.get("token")).toBe("access");
    received = null;
    expect((await runLogout()).code).toBe(0);
    expect(received).toBeNull();
  });
});
