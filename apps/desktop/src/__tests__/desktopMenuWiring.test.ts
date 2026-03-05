// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop menu wiring", () => {
  it("wires settings + update menu actions and removes legacy preferences shortcuts", () => {
    const appSource = readFileSync(
      resolve(import.meta.dir, "../App.tsx"),
      "utf8"
    );
    const menuHookSource = readFileSync(
      resolve(import.meta.dir, "../hooks/useDesktopMenuEvents.ts"),
      "utf8"
    );

    expect(appSource).toContain("onSettings: handleSettingsMenuClick");
    expect(appSource).toContain("onCheckForUpdates");
    expect(appSource).toContain("checkForUpdatesInteractively");
    expect(appSource).not.toContain("onPreferences");
    expect(appSource).not.toContain("window.addEventListener(\"keydown\"");

    expect(menuHookSource).toContain("\"desktop://menu/settings\"");
    expect(menuHookSource).toContain("\"desktop://menu/check-for-updates\"");
    expect(menuHookSource).not.toContain("\"desktop://menu/preferences\"");
  });
});
