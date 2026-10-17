/// <reference types="bun" />

/** An in-memory `chrome.storage.local`, enough for the modules under test. */
export function installChromeStorage(
  extra: Record<string, unknown> = {}
): Map<string, unknown> {
  const items = new Map<string, unknown>();
  globalThis.chrome = {
    ...extra,
    storage: {
      local: {
        get: async (key: string) =>
          items.has(key) ? { [key]: items.get(key) } : {},
        remove: (key: string) => {
          items.delete(key);
          return Promise.resolve();
        },
        set: (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) {
            items.set(key, value);
          }
          return Promise.resolve();
        },
      },
    },
  } as unknown as typeof chrome;
  return items;
}
