import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";

const API_URL_KEY = "teak_api_url";
const DEFAULT_URL = "http://192.168.29.57:3000"

export const getStoredApiUrl = async (): Promise<string> => {
  try {
    return (await SecureStore.getItemAsync(API_URL_KEY)) || DEFAULT_URL;
  } catch (error) {
    console.error("Failed to get stored API URL:", error);
    return DEFAULT_URL;
  }
};

export const storeApiUrl = async (url: string): Promise<void> => {
  try {
    await SecureStore.setItemAsync(API_URL_KEY, url);
  } catch (error) {
    console.error("Failed to store API URL:", error);
  }
};

export const createAuthClientWithUrl = () => {
  let serverURL = DEFAULT_URL;

  useEffect(() => {
    const fetchApiUrl = async () => {
      serverURL = await getStoredApiUrl();
    };

    fetchApiUrl();
  }, []);

  // Ensure URL has proper format
  const formattedURL = serverURL.endsWith('/') ? serverURL.slice(0, -1) : serverURL;

  return createAuthClient({
    baseURL: `${formattedURL}/api/auth`,
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
