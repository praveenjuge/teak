// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop OAuth auth wiring", () => {
  test("starts browser OAuth through the authorization server and loopback callback", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../lib/native-auth.ts"),
      "utf8"
    );

    // Authorize through the web origin so the browser session cookie applies.
    expect(source).toContain('buildWebUrl("/api/auth/mcp/authorize")');
    expect(source).toContain("client_id");
    expect(source).toContain("code_challenge_method");
    // Loopback callback listener started via the main-process IPC bridge.
    expect(source).toContain("window.teakDesktop.oauth.listen()");
    expect(source).toContain("startDesktopOAuthRequest");
  });

  test("completes the flow via token exchange and dedicated session exchange", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../lib/native-auth.ts"),
      "utf8"
    );

    expect(source).toContain("completeDesktopOAuth");
    // Back-channel code -> access token exchange.
    expect(source).toContain("/api/auth/mcp/token");
    // Access token -> dedicated desktop session exchange.
    expect(source).toContain("/api/native/auth/oauth-exchange");
    // State is compared in constant time to guard the loopback callback.
    expect(source).toContain("timingSafeEqual");
  });
});
