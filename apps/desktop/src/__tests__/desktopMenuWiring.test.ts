// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop menu wiring", () => {
  it("wires shared menu events through the declarative registry", () => {
    const appSource = readFileSync(
      resolve(import.meta.dir, "../App.tsx"),
      "utf8"
    );
    const settingsSource = readFileSync(
      resolve(import.meta.dir, "../pages/SettingsPage.tsx"),
      "utf8"
    );
    const menuHookSource = readFileSync(
      resolve(import.meta.dir, "../hooks/useDesktopMenuEvents.ts"),
      "utf8"
    );
    const rustSource = readFileSync(
      resolve(import.meta.dir, "../../src-tauri/src/lib.rs"),
      "utf8"
    );

    expect(appSource).toContain("onSettings: handleSettingsMenuClick");
    expect(appSource).toContain("onCheckForUpdates");
    expect(appSource).toContain("checkForUpdatesInteractively");
    expect(appSource).not.toContain("onPreferences");

    expect(menuHookSource).toContain('"desktop://menu/settings"');
    expect(menuHookSource).toContain('"desktop://menu/check-for-updates"');
    expect(menuHookSource).not.toContain('"desktop://menu/preferences"');

    expect(settingsSource).not.toContain('window.addEventListener("keydown"');

    expect(rustSource).toContain("const MENU_ACTIONS: [MenuAction; 5]");
    expect(rustSource).toContain('event_name: Some(MENU_SETTINGS_EVENT)');
    expect(rustSource).toContain('event_name: Some(MENU_CHECK_UPDATES_EVENT)');
    expect(rustSource).toContain('event_name: Some(MENU_LOGOUT_EVENT)');
    expect(rustSource).toContain(
      "native_handler: Some(NativeMenuHandler::CloseWindow)"
    );
    expect(rustSource).toContain("native_handler: Some(NativeMenuHandler::Quit)");
  });
});
