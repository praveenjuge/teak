import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@teak/convex";

export type AutoSaveState = "idle" | "loading" | "success" | "error" | "invalid-url";

export interface UseAutoSaveLinkResult {
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

export const useAutoSaveLink = (isAuthenticated: boolean = false): UseAutoSaveLinkResult => {
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

        // Create the link card
        await createCard({
          content: currentTab.url,
          type: "link",
          url: currentTab.url,
          metadata: {
            linkTitle: currentTab.title || undefined,
            linkDescription: undefined,
            linkImage: undefined,
          },
        });

        setState("success");
        
        // Reset to idle after 2 seconds
        setTimeout(() => {
          setState("idle");
        }, 2000);

      } catch (err) {
        console.error("Failed to save link:", err);
        setState("error");
        setError(err instanceof Error ? err.message : "Failed to save link");
      }
    };

    saveCurrentTab();
  }, [createCard, isAuthenticated]);

  return {
    state,
    error,
    currentUrl,
  };
};