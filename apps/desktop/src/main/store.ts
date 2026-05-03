import ElectronStore from "electron-store";

let store: ElectronStore | null = null;

const ALLOWED_STORE_KEYS = new Set([
  "auth.sessionToken",
  "auth.deviceId",
  "auth.pendingDesktopFlow",
]);

function isAllowedKey(key: string): boolean {
  return ALLOWED_STORE_KEYS.has(key);
}

export function createStore(): void {
  store = new ElectronStore({
    name: "teak-desktop",
    encryptionKey: "teak-desktop-store",
  });
}

export function readStoreValue<T>(key: string): T | null {
  if (!store || !isAllowedKey(key)) {
    return null;
  }
  const value = store.get(key) as T | undefined;
  return value ?? null;
}

export async function writeStoreValue(
  key: string,
  value: unknown
): Promise<void> {
  if (!store || !isAllowedKey(key)) {
    return;
  }
  if (value === null || value === undefined) {
    store.delete(key);
  } else {
    store.set(key, value);
  }
}
