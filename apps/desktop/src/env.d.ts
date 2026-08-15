/// <reference types="vite/client" />
/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

/**
 * Typed preload API exposed by the Electron preload script.
 * See src/preload/index.ts for the implementation.
 */
interface TeakDesktopApi {
  app: {
    getVersion: () => Promise<string>;
  };
  oauth: {
    listen: () => Promise<{ port: number }>;
    cancel: () => Promise<void>;
    onCallback: (
      callback: (payload: { code: string; state: string }) => void
    ) => () => void;
  };
  onMenuEvent: (channel: string, callback: () => void) => () => void;
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  store: {
    read: <T>(key: string) => Promise<T | null>;
    write: (key: string, value: unknown) => Promise<void>;
  };
}

declare global {
  interface Window {
    teakDesktop: TeakDesktopApi;
  }
}

export {};
