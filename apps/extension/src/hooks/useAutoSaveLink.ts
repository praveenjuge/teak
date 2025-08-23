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

export const useAutoSaveLink = (
  isAuthenticated: boolean = false, 
  contextMenuState?: { status: string; url?: string } | null
): UseAutoSaveLinkResult => {
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

    // Skip auto-save if there's any active context menu state
    // This means the popup was opened from a context menu action, not from clicking the extension icon
    if (contextMenuState) {
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
          metadata: {},
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

    // Check directly with background script for context menu state to avoid React state race conditions
    const checkContextMenuAndSave = async () => {
      try {
        // Check background script directly for context menu state
        const backgroundState = await chrome.runtime.sendMessage({ type: 'GET_CONTEXT_MENU_STATE' });
        
        // Check if state is recent (within last 30 seconds) - same logic as useContextMenuState
        const isRecentContextMenuState = backgroundState && (Date.now() - backgroundState.timestamp) < 30000;
        
        // If there's recent context menu state, don't auto-save
        if (isRecentContextMenuState) {
          setState("idle");
          return;
        }
        
        // No recent context menu state, proceed with auto-save
        await saveCurrentTab();
      } catch (error) {
        console.error("Failed to check context menu state:", error);
        // If we can't check context menu state, proceed with auto-save as fallback
        await saveCurrentTab();
      }
    };

    // Add a small delay to ensure background state is set if this was triggered by context menu
    const timeoutId = setTimeout(checkContextMenuAndSave, 50);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [createCard, isAuthenticated, contextMenuState]);

  return {
    state,
    error,
    currentUrl,
  };
};