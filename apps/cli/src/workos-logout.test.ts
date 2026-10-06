import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const server = serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/v1/oauth/disconnect") {
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBe("Bearer signed-access");
      expect(await request.text()).toBe("");
      disconnects++;
      return new Response(null, {
        status: responseStatus,
        ...(responseStatus === 302
          ? { headers: { Location: `${server.url.origin}/exfiltrate` } }
          : {}),
      });
    }
    if (url.pathname.endsWith("oauth-protected-resource/mcp")) {
      return Response.json({
        resource: `${server.url.origin}/mcp`,
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
