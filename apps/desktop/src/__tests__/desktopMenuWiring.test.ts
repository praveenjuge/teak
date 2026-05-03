// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop menu wiring", () => {
  it("wires shared menu events through the Electron preload bridge", () => {
    const appSource = readFileSync(
      resolve(import.meta.dir, "../App.tsx"),
      "utf8"
    );
    const menuHookSource = readFileSync(
      resolve(import.meta.dir, "../hooks/useDesktopMenuEvents.ts"),
      "utf8"
    );
    const mainSource = readFileSync(
      resolve(import.meta.dir, "../main/index.ts"),
      "utf8"
    );
    const preloadSource = readFileSync(
      resolve(import.meta.dir, "../preload/index.ts"),
      "utf8"
    );

    // App wires settings and logout menu events
    expect(appSource).toContain("onSettings: handleSettingsMenuClick");
    expect(appSource).toContain("onLogout");
    expect(appSource).not.toContain("onPreferences");
    // Check for Updates is postponed in Electron migration
    expect(appSource).not.toContain("onCheckForUpdates");

    // Menu hook uses the preload bridge, not Tauri event listener
    expect(menuHookSource).toContain("window.teakDesktop.onMenuEvent");
    expect(menuHookSource).toContain('"desktop://menu/settings"');
    expect(menuHookSource).toContain('"desktop://menu/logout"');
    expect(menuHookSource).not.toContain("@tauri-apps");

    // Main process defines the macOS menu with Settings and Log Out
    expect(mainSource).toContain('"Settings..."');
    expect(mainSource).toContain('"Log Out"');
    expect(mainSource).toContain("desktop://menu/settings");
    expect(mainSource).toContain("desktop://menu/logout");

    // Preload exposes onMenuEvent with allowed channels
    expect(preloadSource).toContain("desktop://menu/settings");
    expect(preloadSource).toContain("desktop://menu/logout");
    expect(preloadSource).toContain("contextBridge.exposeInMainWorld");
  });

  it("does not import any Tauri packages in renderer code", () => {
    const files = [
      "../App.tsx",
      "../hooks/useDesktopMenuEvents.ts",
      "../hooks/useDesktopUpdater.ts",
      "../hooks/useGlobalDragDrop.ts",
      "../lib/auth-window.ts",
      "../lib/store.ts",
      "../pages/CardsPage.tsx",
      "../pages/SettingsPage.tsx",
    ];

    for (const file of files) {
      const source = readFileSync(resolve(import.meta.dir, file), "utf8");
      expect(source).not.toContain("@tauri-apps");
    }
  });
});
