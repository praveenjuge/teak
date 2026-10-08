import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logout } from "./runtime";

// Exercise the real credential store and logout. Network and native Keychain
// commands are isolated boundaries; credentials that predate WorkOS must be
// cleared on this device without any request.
test.each([
  ["unbound production", undefined],
  [
    "Better Auth bound",
    {
      apiUrl: "https://teakvault.com/api",
      issuer: "https://app.teakvault.com",
      clientId: "teak-cli",
      revocationEndpoint: "https://teakvault.com/api/api/oauth/revoke",
    },
  ],
])(
  "logout clears %s credentials locally without a network call",
  async (_name, binding) => {
    const directory = mkdtempSync(join(tmpdir(), "teak-legacy-logout-"));
    mkdirSync(join(directory, "teak"), { mode: 0o700 });
    writeFileSync(join(directory, "security"), "#!/bin/sh\nexit 1\n", {
      mode: 0o700,
    });
    const file = join(directory, "teak", "credentials.json");
    writeFileSync(
      file,
      JSON.stringify({
        accessToken: "fixture-access",
        refreshToken: "fixture-refresh",
        expiresAt: 0,
        ...(binding ? { binding } : {}),
      }),
      { mode: 0o600 }
    );
    const previous = {
      PATH: process.env.PATH,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      TEAK_AUTH_URL: process.env.TEAK_AUTH_URL,
    };
    const originalFetch = globalThis.fetch;
    let requests = 0;
    try {
      process.env.PATH = `${directory}:${previous.PATH}`;
      process.env.XDG_CONFIG_HOME = directory;
      process.env.TEAK_AUTH_URL = "";
      globalThis.fetch = (() => {
        requests++;
        return Promise.reject(new Error("Offline"));
      }) as unknown as typeof fetch;
      await logout({ apiUrl: "https://teakvault.com/api" });
      expect(readFileSync(file, "utf8")).toBe("");
      expect(requests).toBe(0);
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
