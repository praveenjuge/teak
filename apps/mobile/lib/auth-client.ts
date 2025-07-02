import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

// Helper functions for URL management
const API_URL_KEY = "teak_api_url";

export const getStoredApiUrl = async (): Promise<string> => {
  try {
    const storedUrl = await SecureStore.getItemAsync(API_URL_KEY);
    return storedUrl || (__DEV__ ? "http://192.168.29.57:3000" : "");
  } catch (error) {
    console.error("Failed to get stored API URL:", error);
    return __DEV__ ? "http://192.168.29.57:3000" : "";
  }
};

export const storeApiUrl = async (url: string): Promise<void> => {
  try {
    await SecureStore.setItemAsync(API_URL_KEY, url);
  } catch (error) {
    console.error("Failed to store API URL:", error);
  }
};

export const createAuthClientWithUrl = (baseURL: string) => {
  // Ensure URL has proper format
  const formattedURL = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;

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

// Initialize auth client with default or stored URL
let _currentAuthClient: ReturnType<typeof createAuthClient> | null = null;

// Initialize the auth client (call this once at app startup)
export const initializeAuthClient = async () => {
  if (_currentAuthClient) return _currentAuthClient;

  const apiUrl = await getStoredApiUrl();
  console.log("Initializing auth client with URL:", apiUrl);
  _currentAuthClient = createAuthClientWithUrl(apiUrl);
  return _currentAuthClient;
};

// Get the current auth client (must be initialized first)
export const getAuthClient = () => {
  if (!_currentAuthClient) {
    // Fallback: create with default URL if not initialized
    console.warn("Auth client not initialized, creating with default URL");
    _currentAuthClient = createAuthClientWithUrl(__DEV__ ? "http://192.168.29.57:3000" : "");
  }
  return _currentAuthClient;
};

// Update the auth client with a new URL
export const updateAuthClient = (baseURL: string) => {
  console.log("Updating auth client with URL:", baseURL);
  _currentAuthClient = createAuthClientWithUrl(baseURL);
  return _currentAuthClient;
};

// Create default client for immediate use (before initialization)
export const authClient = createAuthClientWithUrl(__DEV__ ? "http://192.168.29.57:3000" : "");
