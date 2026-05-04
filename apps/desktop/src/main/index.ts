import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  shell,
} from "electron";
import electronUpdater from "electron-updater";
import { IPC_CHANNELS, MENU_CHANNELS } from "./channels";
import { createStore, readStoreValue, writeStoreValue } from "./store";

const { autoUpdater } = electronUpdater;

// ── Constants ──────────────────────────────────────────────────────────────────

const MAIN_WINDOW_WIDTH = 1000;
const MAIN_WINDOW_HEIGHT = 700;
const MAIN_WINDOW_MIN_WIDTH = 800;
const MAIN_WINDOW_MIN_HEIGHT = 600;

const ALLOWED_URL_PROTOCOLS = new Set(["https:", "http:"]);

// ── State ──────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let manualUpdateCheck = false;

// ── Helpers ────────────────────────────────────────────────────────────────────

function isValidExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_URL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

// ── Main Window ────────────────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const preloadPath = join(import.meta.dirname, "../preload/index.js");
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
  if (!process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.session.webRequest.onHeadersReceived(
      (details, callback) => {
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
  mainWindow.webContents.on("will-navigate", (event, url) => {
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
  });

  // Prevent new window creation except for approved external URLs
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isValidExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Load the renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }

  // Auto-open DevTools in dev mode
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

// ── IPC Handlers ───────────────────────────────────────────────────────────────

function setupIpcHandlers(): void {
  ipcMain.handle(
    "store:read",
    async (_event: Electron.IpcMainInvokeEvent, key: string) => {
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
            autoUpdater.checkForUpdates().catch((err) => {
              manualUpdateCheck = false;
              // In dev mode there's no app-update.yml, so show a helpful message
              const isDev = !!process.env.ELECTRON_RENDERER_URL;
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
          autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on("update-downloaded", (info) => {
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
