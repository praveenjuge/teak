import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";

const API_URL_KEY = "teak_api_url";
const DEFAULT_URL = "http://192.168.29.96:3000"

export const getStoredApiUrl = async (): Promise<string> => {
  try {
    const storedUrl = await SecureStore.getItemAsync(API_URL_KEY);
    const url = storedUrl || DEFAULT_URL;
    console.log('[AuthClient] Retrieved API URL:', { storedUrl, url });
    return url;
  } catch (error) {
    console.error("[AuthClient] Failed to get stored API URL:", error);
    return DEFAULT_URL;
  }
};

export const storeApiUrl = async (url: string): Promise<void> => {
  try {
    await SecureStore.setItemAsync(API_URL_KEY, url);
    console.log('[AuthClient] Stored API URL:', url);
  } catch (error) {
    console.error("[AuthClient] Failed to store API URL:", error);
  }
};

export const createAuthClientWithUrl = () => {
  let serverURL = DEFAULT_URL;

  useEffect(() => {
    const fetchApiUrl = async () => {
      serverURL = await getStoredApiUrl();
      console.log('[AuthClient] Auth client initialized with URL:', serverURL);
    };

    fetchApiUrl();
  }, []);

  // Ensure URL has proper format
  const formattedURL = serverURL.endsWith('/') ? serverURL.slice(0, -1) : serverURL;
  const baseURL = `${formattedURL}/api/auth`;

  console.log('[AuthClient] Creating auth client:', { serverURL, formattedURL, baseURL });

  return createAuthClient({
    baseURL,
    plugins: [
      expoClient({
        scheme: "teak",
        storagePrefix: "teak",
        storage: SecureStore,
      }),
    ],
  });
};

export const authClient = createAuthClientWithUrl();
