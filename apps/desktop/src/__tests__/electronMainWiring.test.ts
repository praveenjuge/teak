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

    // IPC channel validation
    expect(source).toContain("IPC_CHANNELS");
    expect(source).toContain("isValidIpcChannel");
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

  it("configures the auth window with correct dimensions", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../main/index.ts"),
      "utf8"
    );

    expect(source).toContain("AUTH_WINDOW_WIDTH = 480");
    expect(source).toContain("AUTH_WINDOW_HEIGHT = 760");
  });

  it("sets up silent auto-updater via electron-updater", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../main/index.ts"),
      "utf8"
    );

    expect(source).toContain('import electronUpdater from "electron-updater"');
    expect(source).toContain("const { autoUpdater } = electronUpdater");
    expect(source).toContain("autoUpdater.autoDownload = true");
    expect(source).toContain("autoUpdater.autoInstallOnAppQuit = true");
    expect(source).toContain("autoUpdater.checkForUpdates()");
  });

  it("validates store keys in the main process store", () => {
    const storeSource = readFileSync(
      resolve(import.meta.dir, "../main/store.ts"),
      "utf8"
    );

    expect(storeSource).toContain("ALLOWED_STORE_KEYS");
    expect(storeSource).toContain('"auth.sessionToken"');
    expect(storeSource).toContain('"auth.deviceId"');
    expect(storeSource).toContain('"auth.pendingDesktopFlow"');
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
