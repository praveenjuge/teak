/// <reference types="bun" />

/** An in-memory storage area, enough for the modules under test. */
const memoryArea = (items: Map<string, unknown>) => ({
  get: async (key: string) => (items.has(key) ? { [key]: items.get(key) } : {}),
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
});

/** In-memory `chrome.storage.local` and `.session`; returns the local items. */
export function installChromeStorage(
  extra: Record<string, unknown> = {}
): Map<string, unknown> {
  const items = new Map<string, unknown>();
  globalThis.chrome = {
    ...extra,
    storage: {
      local: memoryArea(items),
      session: memoryArea(new Map()),
    },
  } as unknown as typeof chrome;
  return items;
}
