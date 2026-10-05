// Stable native boundary shape prevents Bun's shared module mocks from losing
// async Keychain methods when the auth-screen suite registers the sync API.
export const secureStoreData = new Map<string, string>();
export const secureStoreMock = {
  getItem: (key: string) => secureStoreData.get(key) ?? null,
  setItem: (key: string, value: string) => {
    secureStoreData.set(key, value);
  },
  getItemAsync: (key: string) =>
    Promise.resolve(secureStoreData.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    secureStoreData.set(key, value);
    return Promise.resolve();
  },
  deleteItemAsync: (key: string) => {
    secureStoreData.delete(key);
    return Promise.resolve();
  },
};
