import { contextBridge, ipcRenderer } from "electron";
import { MENU_CHANNELS, OAUTH_CALLBACK_CHANNEL } from "../main/channels";

console.log("[preload] loading teakDesktop bridge");

const allowedMenuChannels = new Set<string>(MENU_CHANNELS);

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

  // ── App ────────────────────────────────────────────────────────────────────
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
  },

  // ── OAuth (browser login) ──────────────────────────────────────────────────
  oauth: {
    // Start the loopback callback server; resolves with the bound port.
    listen: (): Promise<{ port: number }> =>
      ipcRenderer.invoke("oauth:listen"),
    // Tear down the loopback server (e.g. on timeout or cancel).
    cancel: (): Promise<void> => ipcRenderer.invoke("oauth:cancel"),
    // Subscribe to the redirect callback. Returns an unsubscribe function.
    onCallback: (
      callback: (payload: { code: string; state: string }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { code: string; state: string }
      ) => callback(payload);
      ipcRenderer.on(OAUTH_CALLBACK_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(OAUTH_CALLBACK_CHANNEL, handler);
      };
    },
  },

  // ── Menu Events (main → renderer) ─────────────────────────────────────────
  onMenuEvent: (channel: string, callback: () => void): (() => void) => {
    if (!allowedMenuChannels.has(channel)) {
      return () => {
        // noop: channel is not in the allowlist, nothing to unsubscribe
      };
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
