// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("preload API shape", () => {
  it("exposes the expected API surface via contextBridge", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../preload/index.ts"),
      "utf8"
    );

    // Store API
    expect(source).toContain("store:");
    expect(source).toContain('"store:read"');
    expect(source).toContain('"store:write"');

    // Shell API
    expect(source).toContain("shell:");
    expect(source).toContain('"shell:open-external"');

    // App API
    expect(source).toContain("app:");
    expect(source).toContain('"app:get-version"');

    // OAuth API
    expect(source).toContain("oauth:");
    expect(source).toContain('"oauth:listen"');
    expect(source).toContain('"oauth:cancel"');
    expect(source).toContain("onCallback:");
    expect(source).toContain("OAUTH_CALLBACK_CHANNEL");

    // Menu events
    expect(source).toContain("onMenuEvent:");

    // Security: uses contextBridge, not direct assignment
    expect(source).toContain("contextBridge.exposeInMainWorld");
    expect(source).toContain('"teakDesktop"');
  });

  it("uses shared channel constants for menu event validation", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../preload/index.ts"),
      "utf8"
    );

    expect(source).toContain("allowedMenuChannels");
    expect(source).toContain("MENU_CHANNELS");
  });
});
