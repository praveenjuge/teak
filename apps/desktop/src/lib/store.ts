import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = "teak-desktop.store.json";

let storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE);
  }
  return storePromise;
}

export async function readStoreValue<T>(key: string): Promise<T | null> {
  const store = await getStore();
  const value = await store.get<T>(key);
  return value ?? null;
}

export async function writeStoreValue(
  key: string,
  value: unknown
): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}
