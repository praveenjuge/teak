// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("electron main process wiring", () => {
  it("enforces security settings in the main process", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../main/index.ts"),
      "utf8"
    );

    // Context isolation and node integration
    expect(source).toContain("nodeIntegration: false");
    expect(source).toContain("contextIsolation: true");
    expect(source).toContain("sandbox: true");

    // CSP headers
    expect(source).toContain("Content-Security-Policy");
    expect(source).toContain("default-src 'self'");

    // URL validation
    expect(source).toContain("isValidExternalUrl");
    expect(source).toContain("ALLOWED_URL_PROTOCOLS");
  });

  it("configures the main window with correct dimensions", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../main/index.ts"),
      "utf8"
    );

    expect(source).toContain("MAIN_WINDOW_WIDTH = 1000");
    expect(source).toContain("MAIN_WINDOW_HEIGHT = 700");
    expect(source).toContain("MAIN_WINDOW_MIN_WIDTH = 800");
    expect(source).toContain("MAIN_WINDOW_MIN_HEIGHT = 600");
  });

  it("uses shared channel constants from channels.ts", () => {
    const channelsSource = readFileSync(
      resolve(import.meta.dir, "../main/channels.ts"),
      "utf8"
    );

    // Shared channel definitions
    expect(channelsSource).toContain("IPC_CHANNELS");
    expect(channelsSource).toContain("MENU_CHANNELS");
    expect(channelsSource).toContain('"store:read"');
    expect(channelsSource).toContain('"store:write"');
    expect(channelsSource).toContain('"shell:open-external"');
    expect(channelsSource).toContain('"app:get-version"');
    expect(channelsSource).toContain('"desktop://menu/settings"');
    expect(channelsSource).toContain('"desktop://menu/logout"');
    expect(channelsSource).toContain('"oauth:listen"');
    expect(channelsSource).toContain('"oauth:cancel"');
    expect(channelsSource).toContain("OAUTH_CALLBACK_CHANNEL");
  });

  it("runs a loopback OAuth callback listener in the main process", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../main/index.ts"),
      "utf8"
    );

    expect(source).toContain("OAUTH_CALLBACK_PORTS");
    expect(source).toContain("/oauth/callback");
    expect(source).toContain('ipcMain.handle("oauth:listen"');
    expect(source).toContain('ipcMain.handle("oauth:cancel"');
    expect(source).toContain("OAUTH_CALLBACK_CHANNEL");
  });

  it("sets up auto-updater with native dialogs via electron-updater", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../main/index.ts"),
      "utf8"
    );

    expect(source).toContain('import electronUpdater from "electron-updater"');
    expect(source).toContain("const { autoUpdater } = electronUpdater");
    expect(source).toContain("autoUpdater.autoDownload = false");
    expect(source).toContain("autoUpdater.autoInstallOnAppQuit = true");
    expect(source).toContain("autoUpdater.checkForUpdates()");
    expect(source).toContain('autoUpdater.on("update-available"');
    expect(source).toContain('autoUpdater.on("update-downloaded"');
    expect(source).toContain('autoUpdater.on("update-not-available"');
    expect(source).toContain("Check for Updates...");
  });

  it("validates store keys in the main process store", () => {
    const storeSource = readFileSync(
      resolve(import.meta.dir, "../main/store.ts"),
      "utf8"
    );

    expect(storeSource).toContain("ALLOWED_STORE_KEYS");
    expect(storeSource).toContain('"auth.sessionToken"');
    expect(storeSource).toContain('"auth.deviceId"');
    expect(storeSource).toContain('"auth.pendingNativeFlow"');
    expect(storeSource).toContain("isAllowedKey");
  });

  it("prevents navigation and new-window creation", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../main/index.ts"),
      "utf8"
    );

    expect(source).toContain("will-navigate");
    expect(source).toContain("setWindowOpenHandler");
    expect(source).toContain('action: "deny"');
  });
});
