import { useEffect, useRef, useState } from "react";
import type { ContextMenuSaveState } from "../types/contextMenu";
import { MESSAGE_TYPES, type TeakSaveResponse } from "../types/messages";

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
  currentUrl?: string;
  duplicateCard?: DuplicateCard | null;
  error?: string;
  state: AutoSaveState;
}

const INVALID_URL_PATTERNS = [
  /^chrome:/,
  /^chrome-extension:/,
  /^about:/,
  /^data:/,
  /^javascript:/,
  /^file:/,
  /^moz-extension:/,
  /^edge-extension:/,
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
  isAuthenticated = false
): UseAutoSaveUrlResult => {
  const [state, setState] = useState<AutoSaveState>("idle");
  const [error, setError] = useState<string>();
  const [currentUrl, setCurrentUrl] = useState<string>();
  const hasCheckedRef = useRef(false);
  const [duplicateCard, setDuplicateCard] = useState<DuplicateCard | null>(
    null
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

      if (contextMenuSave?.timestamp) {
        const timeSinceContextMenu = Date.now() - contextMenuSave.timestamp;
        if (timeSinceContextMenu < 5000) {
          // Within 5 seconds of context menu action
          setState("idle");
          hasCheckedRef.current = true;
          return;
        }
      }

      try {
        // Get current tab
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
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

        const response = await new Promise<TeakSaveResponse>(
          (resolve, reject) => {
            chrome.runtime.sendMessage(
              {
                type: MESSAGE_TYPES.SAVE_CONTENT,
                payload: {
                  content: currentTab.url,
                  source: "popup-auto-save",
                },
              },
              (messageResponse: TeakSaveResponse) => {
                const runtimeError = chrome.runtime.lastError;
                if (runtimeError) {
                  reject(new Error(runtimeError.message));
                  return;
                }
                resolve(messageResponse);
              }
            );
          }
        );

        if (response.status === "saved") {
          setState("success");
          hasCheckedRef.current = true;
          return;
        }

        if (response.status === "duplicate") {
          setDuplicateCard(null);
          setState("duplicate");
          hasCheckedRef.current = true;
          return;
        }

        if (response.status === "unauthenticated") {
          setState("error");
          setError("Please log in to Teak to save links.");
          hasCheckedRef.current = true;
          return;
        }

        setState("error");
        setError(response.message);
        hasCheckedRef.current = true;
      } catch (err) {
        setState("error");
        setError(
          err instanceof Error ? err.message : "Failed to get current tab"
        );
        hasCheckedRef.current = true;
      }
    };

    const timeoutId = setTimeout(getCurrentTab, 300);
    return () => clearTimeout(timeoutId);
  }, [isAuthenticated]);

  return {
    state,
    error,
    currentUrl,
    duplicateCard,
  };
};
