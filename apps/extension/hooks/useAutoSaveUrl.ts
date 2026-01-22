import { useEffect, useState, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../lib/convex-api";
import type { ContextMenuSaveState } from "../types/contextMenu";

export type AutoSaveState =
  | "idle"
  | "loading"
  | "success"
  | "error"
  | "invalid-url"
  | "duplicate";

export type DuplicateCard = {
  _id: string;
  _creationTime: number;
  content: string;
  type: string;
  url?: string;
  createdAt: number;
  metadataTitle?: string;
  metadataDescription?: string;
  linkPreviewImageUrl?: string;
};

export interface UseAutoSaveUrlResult {
  state: AutoSaveState;
  error?: string;
  currentUrl?: string;
  duplicateCard?: DuplicateCard | null;
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
  const [urlToCheck, setUrlToCheck] = useState<string>();
  const hasCheckedRef = useRef(false);
  const createCard = useMutation(api.cards.createCard);

  // Query for duplicate card using Convex's useQuery
  const duplicateCard = useQuery(
    api.cards.findDuplicateCard,
    urlToCheck ? { url: urlToCheck } : "skip"
  );

  // Step 1: Get the current tab URL
  useEffect(() => {
    if (!isAuthenticated || hasCheckedRef.current) {
      return;
    }

    const getCurrentTab = async () => {
      // Double-check for context menu state before saving
      const { contextMenuSave } = await chrome.storage.local.get<{
        contextMenuSave?: ContextMenuSaveState;
      }>("contextMenuSave");

      if (contextMenuSave && contextMenuSave.timestamp) {
        const timeSinceContextMenu = Date.now() - contextMenuSave.timestamp;
        if (timeSinceContextMenu < 5000) { // Within 5 seconds of context menu action
          setState("idle");
          hasCheckedRef.current = true;
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
          hasCheckedRef.current = true;
          return;
        }

        setCurrentUrl(currentTab.url);

        // Check if URL is valid for saving
        if (!isValidUrl(currentTab.url)) {
          setState("invalid-url");
          hasCheckedRef.current = true;
          return;
        }

        setState("loading");
        setUrlToCheck(currentTab.url);
      } catch (err) {
        setState("error");
        setError(err instanceof Error ? err.message : "Failed to get current tab");
        hasCheckedRef.current = true;
      }
    };

    const timeoutId = setTimeout(getCurrentTab, 300);
    return () => clearTimeout(timeoutId);
  }, [isAuthenticated]);

  // Step 2: Handle duplicate check result and save if needed
  useEffect(() => {
    if (!urlToCheck || state !== "loading") {
      return;
    }

    // If duplicate query is still loading, wait
    if (duplicateCard === undefined) {
      return;
    }

    // If duplicate found, show duplicate state
    if (duplicateCard) {
      setState("duplicate");
      hasCheckedRef.current = true;
      return;
    }

    // No duplicate - create the card
    const saveCard = async () => {
      try {
        await createCard({
          content: urlToCheck,
        });
        setState("success");
      } catch (err) {
        setState("error");
        setError(err instanceof Error ? err.message : "Failed to save link");
      }
      hasCheckedRef.current = true;
    };

    saveCard();
  }, [urlToCheck, duplicateCard, state, createCard]);

  return {
    state,
    error,
    currentUrl,
    duplicateCard: duplicateCard ?? null,
  };
};
