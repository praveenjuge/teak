import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';

const API_URL_KEY = 'teak_api_url';

export const getStoredApiUrl = () => {
  try {
    const storedUrl = SecureStore.getItem(API_URL_KEY);
    const url = storedUrl;
    console.log('[AuthClient] Retrieved API URL:', { storedUrl, url });
    return url;
  } catch (error) {
    console.error('[AuthClient] Failed to get stored API URL:', error);
  }
};

export const storeApiUrl = async (url: string): Promise<void> => {
  try {
    await SecureStore.setItemAsync(API_URL_KEY, url);
    console.log('[AuthClient] Stored API URL:', url);
  } catch (error) {
    console.error('[AuthClient] Failed to store API URL:', error);
  }
};

export const createAuthClientWithUrl = () => {
  const serverURL = getStoredApiUrl();
  const formattedURL = serverURL?.endsWith('/')
    ? serverURL.slice(0, -1)
    : serverURL;
  const baseURL = `${formattedURL}/api/auth`;

  if (!formattedURL) {
    console.warn(
      '[AuthClient] No API URL configured, auth client will not work'
    );
    return null;
  }

  return createAuthClient({
    baseURL,
    plugins: [
      expoClient({
        scheme: 'teak',
        storagePrefix: 'teak',
        storage: SecureStore,
      }),
    ],
  });
};

export const authClient = createAuthClientWithUrl();
