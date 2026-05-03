import { contextBridge, ipcRenderer } from "electron";

console.log("[preload] loading teakDesktop bridge");

/**
 * Typed preload API exposed to the renderer as `window.teakDesktop`.
 *
 * Security: contextIsolation is enabled, nodeIntegration is disabled,
 * and sandbox is true. Only these explicitly bridged methods are available.
 */
const teakDesktopApi = {
  // ── Store ──────────────────────────────────────────────────────────────────
  store: {
    read: <T>(key: string): Promise<T | null> =>
      ipcRenderer.invoke("store:read", key),
    write: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke("store:write", key, value),
  },

  // ── Shell ──────────────────────────────────────────────────────────────────
  shell: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke("shell:open-external", url),
  },

  // ── Auth Window ────────────────────────────────────────────────────────────
  auth: {
    openWindow: (url: string): Promise<void> =>
      ipcRenderer.invoke("auth:open-window", url),
    closeWindow: (): Promise<void> =>
      ipcRenderer.invoke("auth:close-window"),
  },

  // ── App ────────────────────────────────────────────────────────────────────
  app: {
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke("app:get-version"),
  },

  // ── Menu Events (main → renderer) ─────────────────────────────────────────
  onMenuEvent: (
    channel: string,
    callback: () => void
  ): (() => void) => {
    const allowedChannels = new Set([
      "desktop://menu/settings",
      "desktop://menu/logout",
    ]);

    if (!allowedChannels.has(channel)) {
      return () => {};
    }

    const handler = () => callback();
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
} as const;

export type TeakDesktopApi = typeof teakDesktopApi;

contextBridge.exposeInMainWorld("teakDesktop", teakDesktopApi);
