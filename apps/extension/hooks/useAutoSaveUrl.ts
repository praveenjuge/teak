import { useEffect, useRef, useState } from "react";
import {
  type ContextMenuSaveState,
  RECENT_CONTEXT_MENU_SAVE_MS,
} from "../types/contextMenu";
import { MESSAGE_TYPES, type TeakSaveResponse } from "../types/messages";

export type AutoSaveState =
  | "idle"
  | "loading"
  | "success"
  | "error"
  | "invalid-url"
  | "duplicate";

export interface DuplicateCard {
  _creationTime: number;
  _id: string;
  content: string;
  createdAt: number;
  linkPreviewImageUrl?: string;
  metadataDescription?: string;
  metadataTitle?: string;
  type: string;
  url?: string;
}

export const TAB_READ_DELAY_MS = 300;

export interface UseAutoSaveUrlResult {
  cardId?: string;
  code?: string;
  /** The tab's own title and icon, for the popup's preview of the page. */
  currentTab?: { favIconUrl?: string; title?: string };
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

export const isValidUrl = (url: string): boolean => {
  if (!url) {
    return false;
  }

  for (const pattern of INVALID_URL_PATTERNS) {
    if (pattern.test(url)) {
      return false;
    }
  }

  return url.startsWith("http://") || url.startsWith("https://");
};

export const useAutoSaveUrl = (
  isAuthenticated = false
): UseAutoSaveUrlResult => {
  const [state, setState] = useState<AutoSaveState>("idle");
  const [error, setError] = useState<string>();
  const [currentUrl, setCurrentUrl] = useState<string>();
  const [currentTab, setCurrentTab] =
    useState<UseAutoSaveUrlResult["currentTab"]>();
  const [cardId, setCardId] = useState<string>();
  const [code, setCode] = useState<string>();
  const hasCheckedRef = useRef(false);
  const [duplicateCard, setDuplicateCard] = useState<DuplicateCard | null>(
    null
  );

  useEffect(() => {
    if (!isAuthenticated || hasCheckedRef.current) {
      return;
    }

    const getCurrentTab = async () => {
      const { contextMenuSave } = await chrome.storage.local.get<{
        contextMenuSave?: ContextMenuSaveState;
      }>("contextMenuSave");

      if (contextMenuSave?.timestamp) {
        const timeSinceContextMenu = Date.now() - contextMenuSave.timestamp;
        if (timeSinceContextMenu < RECENT_CONTEXT_MENU_SAVE_MS) {
          setState("idle");
          hasCheckedRef.current = true;
          return;
        }
      }

      try {
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
        setCurrentTab({
          favIconUrl: currentTab.favIconUrl,
          title: currentTab.title,
        });

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
                  ...(currentTab.id === undefined
                    ? {}
                    : { tabId: currentTab.id }),
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
          setCardId(response.cardId);
          setState("success");
          hasCheckedRef.current = true;
          return;
        }

        if (response.status === "duplicate") {
          setCardId(response.cardId);
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
        setCode(response.code);
        hasCheckedRef.current = true;
      } catch (err) {
        setState("error");
        setError(
          err instanceof Error ? err.message : "Failed to get current tab"
        );
        hasCheckedRef.current = true;
      }
    };

    const timeoutId = setTimeout(getCurrentTab, TAB_READ_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [isAuthenticated]);

  return {
    cardId,
    code,
    state,
    error,
    currentTab,
    currentUrl,
    duplicateCard,
  };
};
