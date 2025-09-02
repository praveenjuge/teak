import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@teak/convex";

export type AutoSaveState = "idle" | "loading" | "success" | "error" | "invalid-url";

export interface UseAutoSaveUrlResult {
  state: AutoSaveState;
  error?: string;
  currentUrl?: string;
}

const INVALID_URL_PATTERNS = [
  /^chrome:/,
  /^chrome-extension:/,
  /^about:/,
  /^data:/,
  /^javascript:/,
  /^file:/,
  /^moz-extension:/,
  /^edge-extension:/
];

const isValidUrl = (url: string): boolean => {
  if (!url) return false;

  // Check against invalid patterns
  for (const pattern of INVALID_URL_PATTERNS) {
    if (pattern.test(url)) {
      return false;
    }
  }

  // Must be http or https
  return url.startsWith("http://") || url.startsWith("https://");
};

export const useAutoSaveUrl = (
  isAuthenticated: boolean = false
): UseAutoSaveUrlResult => {
  const [state, setState] = useState<AutoSaveState>("idle");
  const [error, setError] = useState<string>();
  const [currentUrl, setCurrentUrl] = useState<string>();
  const createCard = useMutation(api.cards.createCard);

  useEffect(() => {
    // Only run if user is authenticated
    if (!isAuthenticated) {
      setState("idle");
      return;
    }

    const saveCurrentTab = async () => {
      // Double-check for context menu state before saving
      const { contextMenuSave } = await chrome.storage.local.get('contextMenuSave');
      
      if (contextMenuSave && contextMenuSave.timestamp) {
        const timeSinceContextMenu = Date.now() - contextMenuSave.timestamp;
        if (timeSinceContextMenu < 5000) { // Within 5 seconds of context menu action
          setState("idle");
          return;
        }
      }
      try {
        // Get current tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];

        if (!currentTab?.url) {
          setState("error");
          setError("No active tab found");
          return;
        }

        setCurrentUrl(currentTab.url);

        // Check if URL is valid for saving
        if (!isValidUrl(currentTab.url)) {
          setState("invalid-url");
          return;
        }

        setState("loading");

        // Create the card - backend will auto-detect as link
        await createCard({
          content: currentTab.url,
        });

        setState("success");

      } catch (err) {
        setState("error");
        setError(err instanceof Error ? err.message : "Failed to save link");
      }
    };

    // Add a longer delay to ensure context menu state is loaded first
    const timeoutId = setTimeout(saveCurrentTab, 300);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [createCard, isAuthenticated]);

  return {
    state,
    error,
    currentUrl,
  };
};