import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logout } from "./runtime";

// Exercise the real credential store/discovery/logout. Network and native
// Keychain commands are isolated boundaries; no production request is sent.
test.each([200, 404, 503])(
  "legacy production logout tries its original provider, then signs out locally (%i)",
  async (status) => {
    const directory = mkdtempSync(join(tmpdir(), "teak-legacy-logout-"));
    mkdirSync(join(directory, "teak"), { mode: 0o700 });
    writeFileSync(join(directory, "security"), "#!/bin/sh\nexit 1\n", {
      mode: 0o700,
    });
    const file = join(directory, "teak", "credentials.json");
    const original = JSON.stringify({
      accessToken: "fixture-access",
      refreshToken: "fixture-refresh",
      expiresAt: 0,
    });
    writeFileSync(file, original, { mode: 0o600 });
    const previous = {
      PATH: process.env.PATH,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      TEAK_AUTH_URL: process.env.TEAK_AUTH_URL,
    };
    const originalFetch = globalThis.fetch;
    let revocations = 0;
    try {
      process.env.PATH = `${directory}:${previous.PATH}`;
      process.env.XDG_CONFIG_HOME = directory;
      process.env.TEAK_AUTH_URL = "";
      globalThis.fetch = (async (input, init) => {
        const url = new URL(String(input));
        if (init?.method === "POST") {
          expect(url.href).toBe("https://teakvault.com/api/api/oauth/revoke");
          const body = new URLSearchParams(
            await new Response(init.body).text()
          );
          expect(body.get("client_id")).toBe("teak-cli");
          expect(body.get("token")).toBe("fixture-refresh");
          expect(init.redirect).toBe("error");
          revocations++;
          return new Response(null, { status });
        }
        const issuer = "https://auth.example.com";
        if (url.pathname.endsWith("oauth-protected-resource/mcp")) {
          return Response.json({
            resource: "https://teakvault.com/mcp",
            authorization_servers: [issuer],
          });
        }
        if (url.pathname.endsWith("teak-oauth-clients.json")) {
          return Response.json({
            primary: "workos",
            issuer,
            clients: Object.fromEntries(
              ["cli", "raycast", "chrome", "firefox", "safari"].map(
                (surface) => [surface, `workos-${surface}`]
              )
            ),
          });
        }
        expect(url.href).toBe(
          `${issuer}/.well-known/oauth-authorization-server`
        );
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          revocation_endpoint: `${issuer}/revoke`,
          code_challenge_methods_supported: ["S256"],
        });
      }) as typeof fetch;
      // The retired route now answers 404; sign-out must still finish.
      await logout({ apiUrl: "https://teakvault.com/api" });
      expect(readFileSync(file, "utf8")).toBe("");
      expect(revocations).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          Reflect.deleteProperty(process.env, key);
        } else {
          process.env[key] = value;
        }
      }
    }
  }
);
