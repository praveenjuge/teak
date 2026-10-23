/// <reference types="bun" />

export const memoryArea = (items: Map<string, unknown>) => ({
  get: (key: string | null) => {
    if (key === null) {
      return Promise.resolve(Object.fromEntries(items));
    }
    return Promise.resolve(items.has(key) ? { [key]: items.get(key) } : {});
  },
  remove: (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      items.delete(key);
    }
    return Promise.resolve();
  },
  set: (values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) {
      items.set(key, value);
    }
    return Promise.resolve();
  },
});

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
