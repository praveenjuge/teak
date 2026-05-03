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

    // Auth API
    expect(source).toContain("auth:");
    expect(source).toContain('"auth:open-window"');
    expect(source).toContain('"auth:close-window"');

    // App API
    expect(source).toContain("app:");
    expect(source).toContain('"app:get-version"');

    // Menu events
    expect(source).toContain("onMenuEvent:");

    // Security: uses contextBridge, not direct assignment
    expect(source).toContain("contextBridge.exposeInMainWorld");
    expect(source).toContain('"teakDesktop"');
  });

  it("validates menu event channels in the preload", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../preload/index.ts"),
      "utf8"
    );

    expect(source).toContain("allowedChannels");
    expect(source).toContain('"desktop://menu/settings"');
    expect(source).toContain('"desktop://menu/logout"');
  });
});
