import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import electronUpdater from "electron-updater";
import { join } from "node:path";
import { createStore, readStoreValue, writeStoreValue } from "./store";

const { autoUpdater } = electronUpdater;

// ── Constants ──────────────────────────────────────────────────────────────────

const MAIN_WINDOW_WIDTH = 1000;
const MAIN_WINDOW_HEIGHT = 700;
const MAIN_WINDOW_MIN_WIDTH = 800;
const MAIN_WINDOW_MIN_HEIGHT = 600;

const AUTH_WINDOW_WIDTH = 480;
const AUTH_WINDOW_HEIGHT = 760;

const IPC_CHANNELS = new Set([
  "store:read",
  "store:write",
  "shell:open-external",
  "auth:open-window",
  "auth:close-window",
  "app:get-version",
]);

const ALLOWED_URL_PROTOCOLS = new Set(["https:", "http:"]);

// ── State ──────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let authWindow: BrowserWindow | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

function isValidExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_URL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function isValidIpcChannel(channel: string): boolean {
  return IPC_CHANNELS.has(channel);
}

// ── Auth Window ────────────────────────────────────────────────────────────────

function createAuthWindow(url: string): BrowserWindow {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
  }

  authWindow = new BrowserWindow({
    width: AUTH_WINDOW_WIDTH,
    height: AUTH_WINDOW_HEIGHT,
    center: true,
    resizable: true,
    fullscreenable: false,
    title: "Teak Login",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Ephemeral partition — fresh session each time (like Tauri incognito),
      // and isolated from the main window's CSP headers.
      partition: `auth-${Date.now()}`,
      // No preload for auth window — it's a plain browser window
    },
  });

  authWindow.loadURL(url);

  // Open DevTools in dev mode for debugging
  if (process.env.ELECTRON_RENDERER_URL) {
    authWindow.webContents.openDevTools();
  }

  authWindow.on("closed", () => {
    authWindow = null;
  });

  // Prevent navigation to unexpected URLs within the auth window
  authWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (!isValidExternalUrl(navigationUrl)) {
      event.preventDefault();
    }
  });

  return authWindow;
}

function closeAuthWindow(): void {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
    authWindow = null;
  }
}

// ── Main Window ────────────────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const preloadPath = join(__dirname, "../preload/index.js");
  console.log("[main] preload path:", preloadPath);

  mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    title: "Teak",
    icon: join(__dirname, "../../build/icon.png"),
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
                "frame-src 'none'",
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
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
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
  // Validate all IPC messages come from known channels
  ipcMain.on("*", (_event: Electron.IpcMainEvent, channel: string) => {
    if (!isValidIpcChannel(channel)) {
      console.warn(`[main] Rejected unknown IPC channel: ${channel}`);
    }
  });

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

  ipcMain.handle(
    "auth:open-window",
    (_event: Electron.IpcMainInvokeEvent, url: string) => {
      if (typeof url !== "string" || !isValidExternalUrl(url)) {
        throw new Error("Invalid auth URL");
      }
      createAuthWindow(url);
    }
  );

  ipcMain.handle("auth:close-window", () => {
    closeAuthWindow();
  });

  ipcMain.handle("app:get-version", () => {
    return app.getVersion();
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

// ── Silent Auto-Updater ────────────────────────────────────────────────────────

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null; // silent

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
