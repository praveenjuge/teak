/// <reference types="vite/client" />

/**
 * Typed preload API exposed by the Electron preload script.
 * See src/preload/index.ts for the implementation.
 */
interface TeakDesktopApi {
  store: {
    read: <T>(key: string) => Promise<T | null>;
    write: (key: string, value: unknown) => Promise<void>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  app: {
    getVersion: () => Promise<string>;
  };
  onMenuEvent: (channel: string, callback: () => void) => () => void;
}

declare global {
  interface Window {
    teakDesktop: TeakDesktopApi;
  }
}

export {};
