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

  it("allows R2 uploads and downloads through the CSP", () => {
    // File uploads PUT directly to R2 and the PDF preview embeds a signed R2
    // URL. Both are blocked in packaged builds unless the R2 host is allowed
    // in connect-src (uploads) and frame-src (PDF iframe).
    const source = readFileSync(
      resolve(import.meta.dir, "../main/index.ts"),
      "utf8"
    );

    const connectSrc = source
      .split("\n")
      .find((line) => line.includes("connect-src"));
    expect(connectSrc).toBeDefined();
    expect(connectSrc).toContain("https://*.r2.cloudflarestorage.com");

    const frameSrc = source
      .split("\n")
      .find((line) => line.includes('"frame-src'));
    expect(frameSrc).toBeDefined();
    expect(frameSrc).toContain("https://*.r2.cloudflarestorage.com");
  });

  it("injects CORS headers on R2 responses so uploads and downloads work", () => {
    // R2 does not return CORS headers for the desktop origin (dev localhost or
    // the packaged file:// null origin), which blocks the upload PUT used for
    // both files and audio recordings. The main process adds the headers and
    // answers the preflight so the renderer's cross-origin request succeeds.
    const source = readFileSync(
      resolve(import.meta.dir, "../main/index.ts"),
      "utf8"
    );

    expect(source).toContain("isR2RequestUrl");
    expect(source).toContain(".r2.cloudflarestorage.com");
    expect(source).toContain("Access-Control-Allow-Origin");
    expect(source).toContain("Access-Control-Allow-Methods");
    expect(source).toContain("Access-Control-Allow-Headers");
    // Preflight (OPTIONS) must be forced to a 2xx for the browser to proceed.
    expect(source).toContain('"OPTIONS"');
    expect(source).toContain("HTTP/1.1 200 OK");
  });

  it("grants only microphone access for audio recording", () => {
    // Electron denies renderer permission requests by default, so getUserMedia
    // rejects until we register permission handlers. Because Electron's `media`
    // permission also covers the camera, the handlers must delegate to the
    // audio-only predicates instead of blanket-approving every `media` request.
    const source = readFileSync(
      resolve(import.meta.dir, "../main/index.ts"),
      "utf8"
    );

    expect(source).toContain("setPermissionRequestHandler");
    expect(source).toContain("setPermissionCheckHandler");
    expect(source).toContain("isMicrophoneOnlyRequest");
    expect(source).toContain("isMicrophoneCheck");
  });

  it("allows clipboard writes so copy actions work", () => {
    // The shared UI copies via navigator.clipboard.writeText/write, which route
    // through Electron's permission handlers. Overriding those handlers for the
    // microphone must not deny clipboard writes ("Write permission denied").
    const source = readFileSync(
      resolve(import.meta.dir, "../main/index.ts"),
      "utf8"
    );

    expect(source).toContain("clipboard-sanitized-write");
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
    expect(source).toContain('class="success-icon"');
    expect(source).toContain('fill="#16a34a"');
    expect(source).toContain('aria-hidden="true"');
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

  it("declares the macOS microphone usage description for packaged builds", () => {
    // macOS terminates the app when it accesses the microphone without an
    // NSMicrophoneUsageDescription, so audio recording fails in the signed
    // build even with the permission handler and entitlement in place.
    const config = readFileSync(
      resolve(import.meta.dir, "../../electron-builder.config.ts"),
      "utf8"
    );

    expect(config).toContain("NSMicrophoneUsageDescription");

    const entitlements = readFileSync(
      resolve(import.meta.dir, "../../build/entitlements.mac.plist"),
      "utf8"
    );
    expect(entitlements).toContain("com.apple.security.device.audio-input");
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
