import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type {
  BrowserWindow as BrowserWindowInstance,
  MenuItemConstructorOptions,
  OnHeadersReceivedListenerDetails,
} from "electron";
import electronUpdater from "electron-updater";
import { OAUTH_CALLBACK_CHANNEL } from "./channels";
import { createStore, readStoreValue, writeStoreValue } from "./store";

// Route the `electron` import through Node's CJS loader.
//
// Why: Node's ESM loader evaluates CJS module getters eagerly when building
// a namespace binding. The `electron` module exposes lazy getters for every
// API, including `safeStorage`. Any static ESM import form — including
// `import { app } from "electron"`, `import electron from "electron"`,
// and `await import("electron")` — fires all those getters. The
// `safeStorage` getter touches the macOS keychain on every app launch,
// which shows a "Teak Safe Storage" password prompt for some users.
//
// `require("electron")` returns the raw CJS exports object without iterating
// properties, so the `safeStorage` getter is never invoked unless we
// actually read it. Fix for the Electron ESM keychain issue; can be
// reverted when Electron 43 ships (see electron/electron PR 50419).
const require = createRequire(import.meta.url);
const electron = require("electron") as typeof import("electron");
const { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } =
  electron;

const { autoUpdater } = electronUpdater;

// `MAIN_WINDOW_VITE_DEV_SERVER_URL` and `MAIN_WINDOW_VITE_NAME` are injected
// at build time by `@electron-forge/plugin-vite`. In dev the URL points at
// the Vite dev server; in prod it's `undefined` and we load the built HTML.
const isDevServer = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "string";

// ── Constants ──────────────────────────────────────────────────────────────────

const MAIN_WINDOW_WIDTH = 1000;
const MAIN_WINDOW_HEIGHT = 700;
const MAIN_WINDOW_MIN_WIDTH = 800;
const MAIN_WINDOW_MIN_HEIGHT = 600;

const ALLOWED_URL_PROTOCOLS = new Set(["https:", "http:"]);

// Loopback OAuth callback (RFC 8252). The desktop client tries 14203 first and
// falls back to 24203; both are registered as exact-match redirect URIs on the
// `teak-desktop` trusted client server-side.
const OAUTH_CALLBACK_PORTS = [14203, 24203];
const OAUTH_CALLBACK_PATH = "/oauth/callback";
const OAUTH_RETURN_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Teak</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; background: #faf9f7; color: #1c1a17; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
      main { text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #6b665f; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>You're signed in</h1>
      <p>Return to the Teak app to continue. You can close this tab.</p>
    </main>
  </body>
</html>`;

// ── State ──────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindowInstance | null = null;
let manualUpdateCheck = false;
let oauthCallbackServer: Server | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

function isValidExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_URL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Show a transient macOS-style system notification. Used for auto-updater
 * progress states ("Checking…", "Downloading…", "Installing…") so the user
 * gets feedback without a blocking modal.
 *
 * Silently no-ops if the OS has notifications disabled for the app.
 */
function showUpdateNotification(title: string, body: string): void {
  if (!Notification.isSupported()) {
    return;
  }
  try {
    new Notification({ title, body, silent: true }).show();
  } catch {
    // Notifications can fail in unsigned dev builds — non-critical, ignore.
  }
}

// ── Main Window ────────────────────────────────────────────────────────────────

function createMainWindow(): BrowserWindowInstance {
  // Forge's plugin-vite emits the preload bundle alongside the main bundle.
  // Our preload Vite config names the output `preload.js`, sibling to `main.js`.
  const preloadPath = join(import.meta.dirname, "preload.js");
  console.log("[main] preload path:", preloadPath);

  mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    title: "Teak",
    icon: join(import.meta.dirname, "../../build/icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
    },
  });

  // CSP for the renderer — only in production; Vite dev server needs inline scripts for HMR
  if (!isDevServer) {
    mainWindow.webContents.session.webRequest.onHeadersReceived(
      (
        details: OnHeadersReceivedListenerDetails,
        callback: (response: {
          responseHeaders?: Record<string, string | string[]>;
        }) => void
      ) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [
              [
                "default-src 'self'",
                "connect-src 'self' https://*.convex.cloud https://*.convex.site wss://*.convex.cloud wss://*.convex.site https://app.teakvault.com https://teakvault.com",
                "img-src 'self' data: blob: https:",
                "media-src 'self' data: blob: https:",
                "style-src 'self' 'unsafe-inline'",
                "font-src 'self' data:",
                "script-src 'self'",
                "object-src 'none'",
                "base-uri 'none'",
              ].join("; "),
            ],
          },
        });
      }
    );
  }

  // Prevent arbitrary navigation
  mainWindow.webContents.on(
    "will-navigate",
    (event: Electron.Event, url: string) => {
      // Allow same-origin navigation for the renderer SPA
      const rendererOrigin = mainWindow?.webContents.getURL();
      if (rendererOrigin) {
        try {
          const currentOrigin = new URL(rendererOrigin).origin;
          const targetOrigin = new URL(url).origin;
          if (currentOrigin === targetOrigin) {
            return;
          }
        } catch {
          // fall through to prevent
        }
      }
      event.preventDefault();
      if (isValidExternalUrl(url)) {
        shell.openExternal(url);
      }
    }
  );

  // Prevent new window creation except for approved external URLs
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (isValidExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Load the renderer
  if (isDevServer && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      join(
        import.meta.dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
      )
    );
  }

  // Auto-open DevTools in dev mode
  if (isDevServer) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    stopOAuthCallbackServer();
    mainWindow = null;
  });

  return mainWindow;
}

// ── OAuth callback (loopback) ────────────────────────────────────────────────

function stopOAuthCallbackServer(): void {
  if (oauthCallbackServer) {
    oauthCallbackServer.close();
    oauthCallbackServer = null;
  }
}

function bindOAuthPort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    const onError = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve(server);
    });
  });
}

/**
 * Start a short-lived loopback HTTP server for the OAuth redirect. Serves a
 * static "return to Teak" page, forwards `{ code, state }` to the renderer via
 * the OAuth callback channel, then shuts down. Tries the two fixed ports in
 * order so the redirect URI matches one of the registered exact values.
 */
async function startOAuthCallbackServer(): Promise<{ port: number }> {
  stopOAuthCallbackServer();

  let server: Server | null = null;
  let boundPort = 0;
  for (const port of OAUTH_CALLBACK_PORTS) {
    try {
      server = await bindOAuthPort(port);
      boundPort = port;
      break;
    } catch {
      server = null;
    }
  }

  if (!server) {
    throw new Error(
      "Unable to start the login listener. Ports 14203 and 24203 are both in use."
    );
  }

  oauthCallbackServer = server;
  server.on("request", (req, res) => {
    const requestUrl = new URL(req.url ?? "/", `http://127.0.0.1:${boundPort}`);
    if (requestUrl.pathname !== OAUTH_CALLBACK_PATH) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(OAUTH_RETURN_HTML);

    if (code && state && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(OAUTH_CALLBACK_CHANNEL, { code, state });
      mainWindow.show();
      mainWindow.focus();
    }

    // Single-shot: tear the listener down once the redirect is handled.
    stopOAuthCallbackServer();
  });

  return { port: boundPort };
}

// ── IPC Handlers ───────────────────────────────────────────────────────────────

function setupIpcHandlers(): void {
  ipcMain.handle(
    "store:read",
    (_event: Electron.IpcMainInvokeEvent, key: string) => {
      if (typeof key !== "string" || !key.trim()) {
        return null;
      }
      return readStoreValue(key);
    }
  );

  ipcMain.handle(
    "store:write",
    async (
      _event: Electron.IpcMainInvokeEvent,
      key: string,
      value: unknown
    ) => {
      if (typeof key !== "string" || !key.trim()) {
        return;
      }
      await writeStoreValue(key, value);
    }
  );

  ipcMain.handle(
    "shell:open-external",
    async (_event: Electron.IpcMainInvokeEvent, url: string) => {
      if (typeof url !== "string" || !isValidExternalUrl(url)) {
        return;
      }
      await shell.openExternal(url);
    }
  );

  ipcMain.handle("app:get-version", () => app.getVersion());

  ipcMain.handle("oauth:listen", () => startOAuthCallbackServer());

  ipcMain.handle("oauth:cancel", () => {
    stopOAuthCallbackServer();
  });
}

// ── Menu ───────────────────────────────────────────────────────────────────────

function emitMenuEvent(channel: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel);
  }
}

function buildAppMenu(): void {
  const appName = "Teak";

  const template: MenuItemConstructorOptions[] = [
    {
      label: appName,
      submenu: [
        { role: "about", label: `About ${appName}` },
        {
          label: "Check for Updates...",
          click: () => {
            manualUpdateCheck = true;
            // Give the user immediate feedback that a check is in flight.
            // The updater's event handlers will surface the outcome
            // (update found, up-to-date, or error) via dialogs below.
            if (!isDevServer) {
              showUpdateNotification(
                "Checking for updates…",
                "Teak is looking for a newer version."
              );
            }
            autoUpdater.checkForUpdates().catch((err) => {
              manualUpdateCheck = false;
              // In dev mode there's no app-update.yml, so show a helpful message
              const isDev = isDevServer;
              dialog.showMessageBox({
                type: isDev ? "info" : "error",
                title: isDev ? "Development Mode" : "Update Error",
                message: isDev
                  ? "Auto-updates are only available in packaged builds."
                  : "Unable to check for updates.",
                detail: isDev ? undefined : err?.message,
                buttons: ["OK"],
              });
            });
          },
        },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => emitMenuEvent("desktop://menu/settings"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        {
          label: "Log Out",
          click: () => emitMenuEvent("desktop://menu/logout"),
        },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Help",
      role: "help",
      submenu: [],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── Auto-Updater ───────────────────────────────────────────────────────────────

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("update-available", (info) => {
    dialog
      .showMessageBox({
        type: "info",
        title: "Update Available",
        message: `A new version (${info.version}) is available.`,
        detail: "Would you like to download it now?",
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          showUpdateNotification(
            `Downloading Teak ${info.version}…`,
            "Teak will let you know when the download is ready to install."
          );
          autoUpdater.downloadUpdate();
        }
      });
  });

  // Reflect download progress in the Dock icon so the user can see the
  // update is still making progress even with the window minimized.
  // `percent` is 0-100; electron wants 0.0-1.0 or -1 to clear.
  autoUpdater.on("download-progress", ({ percent }) => {
    if (app.dock) {
      app.dock.setBadge(`${Math.round(percent)}%`);
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    if (app.dock) {
      app.dock.setBadge("");
    }
    dialog
      .showMessageBox({
        type: "info",
        title: "Update Ready",
        message: `Version ${info.version} has been downloaded.`,
        detail: "Restart now to apply the update?",
        buttons: ["Restart", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          showUpdateNotification(
            `Installing Teak ${info.version}…`,
            "Teak will quit and relaunch with the new version."
          );
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on("update-not-available", () => {
    if (manualUpdateCheck) {
      dialog.showMessageBox({
        type: "info",
        title: "You're up to date!",
        message: `Teak ${app.getVersion()} is currently the newest version available.`,
        buttons: ["OK"],
      });
      manualUpdateCheck = false;
    }
  });

  autoUpdater.on("error", (err) => {
    if (app.dock) {
      app.dock.setBadge("");
    }
    if (manualUpdateCheck) {
      dialog.showMessageBox({
        type: "error",
        title: "Update Error",
        message: "Failed to check for updates.",
        detail: err.message,
        buttons: ["OK"],
      });
      manualUpdateCheck = false;
    }
  });

  // Check on launch — dialogs only appear if an update is found
  autoUpdater.checkForUpdates().catch(() => {
    // Silent failure — retry on next launch
  });
}

// ── App Lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createStore();
  setupIpcHandlers();
  buildAppMenu();
  createMainWindow();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
