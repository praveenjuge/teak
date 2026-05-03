export async function readStoreValue<T>(key: string): Promise<T | null> {
  return window.teakDesktop.store.read<T>(key);
}

export async function writeStoreValue(
  key: string,
  value: unknown
): Promise<void> {
  await window.teakDesktop.store.write(key, value);
}
