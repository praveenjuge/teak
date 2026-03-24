import { posthog } from "../lib/posthog";
import { saveToTeak } from "../lib/saveToTeak";
import type { ContextMenuAction } from "../types/contextMenu";
import {
  type AuthStateResponse,
  MESSAGE_TYPES,
  type SaveContentRequest,
  type SavePostRequest,
  type TeakRuntimeRequest,
  type TeakSaveResponse,
} from "../types/messages";
import {
  getInlineSavePlatformRule,
  isInlineSavePermalinkAllowed,
  isSupportedInlineSaveHost,
} from "../types/social";
import { hasValidSession } from "../utils/getSessionFromCookies";

function captureSaveResult(
  result: TeakSaveResponse,
  source: string,
  contentType: "url" | "text"
) {
  if (result.status === "saved") {
    posthog.capture("content saved", { source, content_type: contentType });
  } else if (result.status === "duplicate") {
    posthog.capture("duplicate content detected", {
      source,
      content_type: contentType,
    });
  } else if (result.status === "error" || result.status === "unauthenticated") {
    posthog.capture("content save failed", {
      source,
      content_type: contentType,
      error_code: result.status === "error" ? result.code : "unauthenticated",
      error_message:
        result.status === "error" ? result.message : "User not authenticated",
    });
  }
}

// Check if a URL is restricted (can't inject scripts)
function isRestrictedUrl(url?: string): boolean {
  if (!url) return true;

  const restrictedPrefixes = [
    "chrome://",
    "chrome-extension://",
    "moz-extension://",
    "edge-extension://",
    "about:",
    "data:",
    "file://",
    "view-source:",
    "filesystem:",
  ];

  return restrictedPrefixes.some((prefix) => url.startsWith(prefix));
}

const getNormalizedHost = (urlString: string): string | null => {
  try {
    return new URL(urlString).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const isInlineSaveHostAllowed = (urlString: string): boolean => {
  const host = getNormalizedHost(urlString);
  if (!host) {
    return false;
  }
  return isSupportedInlineSaveHost(host);
};

const buildSaveError = (message: string, code?: string): TeakSaveResponse => ({
  status: "error",
  message,
  code,
});

const buildContextMenuErrorMessage = (result: TeakSaveResponse): string => {
  if (result.status === "unauthenticated") {
    return "Please log in to Teak to save content.";
  }

  if (result.status === "error") {
    return result.message;
  }

  return "Failed to save content";
};

async function extractContextMenuContent(
  action: ContextMenuAction,
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab
): Promise<string> {
  switch (action) {
    case "save-page": {
      if (!tab.url) {
        throw new Error("Could not access page URL");
      }
      return tab.url;
    }
    case "save-text": {
      if (!tab.id) {
        throw new Error("Could not access page content");
      }

      if (typeof info.selectionText === "string" && info.selectionText.trim()) {
        return info.selectionText.trim();
      }

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const selection = window.getSelection();
            const selectedText = selection ? selection.toString().trim() : "";
            return selectedText || document.title || "";
          },
        });

        const content = results[0]?.result;
        if (typeof content === "string" && content.trim()) {
          return content.trim();
        }
      } catch {
        // Fall through to tab-title fallback below.
      }

      if (tab.title?.trim()) {
        return tab.title.trim();
      }

      throw new Error(
        "Could not access page content. Please select text and try again."
      );
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

const isRuntimeRequest = (message: unknown): message is TeakRuntimeRequest => {
  if (!message || typeof message !== "object") {
    return false;
  }

  const candidate = message as { type?: unknown };
  return (
    candidate.type === MESSAGE_TYPES.GET_AUTH_STATE ||
    candidate.type === MESSAGE_TYPES.SAVE_CONTENT ||
    candidate.type === MESSAGE_TYPES.SAVE_POST
  );
};

export default defineBackground(() => {
  // Create context menus when extension starts
  chrome.runtime.onStartup.addListener(createContextMenus);
  chrome.runtime.onInstalled.addListener(createContextMenus);

  // Handle context menu clicks
  chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  // Create context menu items
  function createContextMenus() {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "save-page",
        title: "Save Page to Teak",
        contexts: ["page"],
      });

      chrome.contextMenus.create({
        id: "save-text",
        title: "Save Text to Teak",
        contexts: ["selection"],
      });
    });
  }

  // Handle context menu clicks with enhanced error handling
  async function handleContextMenuClick(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab
  ) {
    if (!tab?.id) {
      return;
    }

    const action = info.menuItemId as ContextMenuAction;

    try {
      // Check if the current page is restricted
      if (isRestrictedUrl(tab.url)) {
        throw new Error(
          `Cannot save content from ${new URL(tab.url || "").protocol} pages. Try using the extension on regular web pages.`
        );
      }

      const content = await extractContextMenuContent(action, info, tab);

      // Store content for processing
      const contextMenuState = {
        action,
        timestamp: Date.now(),
        status: "saving",
      };

      await chrome.storage.local.set({
        contextMenuSave: contextMenuState,
      });

      const saveResult = await saveToTeak({
        content,
        source: "context-menu",
      });
      void captureSaveResult(
        saveResult,
        "context-menu",
        action === "save-text" ? "text" : "url"
      );

      if (saveResult.status === "saved" || saveResult.status === "duplicate") {
        await chrome.storage.local.set({
          contextMenuSave: {
            action,
            timestamp: Date.now(),
            status: "success",
          },
        });
      } else {
        throw new Error(buildContextMenuErrorMessage(saveResult));
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save content";

      await chrome.storage.local.set({
        contextMenuSave: {
          action,
          timestamp: Date.now(),
          status: "error",
          error: errorMessage,
        },
      });
    }

    // Open popup to show save status
    void chrome.action.openPopup();
  }

  function handleRuntimeMessage(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: AuthStateResponse | TeakSaveResponse) => void
  ): boolean | undefined {
    if (!isRuntimeRequest(message)) {
      return undefined;
    }

    void (async () => {
      try {
        if (message.type === MESSAGE_TYPES.GET_AUTH_STATE) {
          const response: AuthStateResponse = {
            authenticated: await hasValidSession(),
          };
          sendResponse(response);
          return;
        }

        if (message.type === MESSAGE_TYPES.SAVE_CONTENT) {
          const saveRequest = message as SaveContentRequest;
          const result = await saveToTeak({
            content: saveRequest.payload.content,
            source: saveRequest.payload.source,
          });
          const isUrl =
            saveRequest.payload.content.startsWith("http://") ||
            saveRequest.payload.content.startsWith("https://");
          void captureSaveResult(
            result,
            saveRequest.payload.source,
            isUrl ? "url" : "text"
          );
          sendResponse(result);
          return;
        }

        if (message.type === MESSAGE_TYPES.SAVE_POST) {
          const postRequest = message as SavePostRequest;
          const senderUrl = sender.tab?.url;
          const platformRule = getInlineSavePlatformRule(
            postRequest.payload.platform
          );

          if (!(senderUrl && isInlineSaveHostAllowed(senderUrl))) {
            sendResponse(
              buildSaveError(
                "Inline save is only supported on supported feed pages.",
                "UNSUPPORTED_HOST"
              )
            );
            return;
          }

          if (
            !(
              senderUrl &&
              isInlineSavePermalinkAllowed(
                postRequest.payload.platform,
                senderUrl,
                postRequest.payload.permalink
              )
            )
          ) {
            sendResponse(
              buildSaveError(
                "Invalid inline save permalink.",
                "UNSUPPORTED_HOST"
              )
            );
            return;
          }

          const senderHost = getNormalizedHost(senderUrl);
          const permalinkHost = getNormalizedHost(
            postRequest.payload.permalink
          );
          if (
            platformRule.permalinkPolicy === "same-host" &&
            (!(senderHost && permalinkHost) || senderHost !== permalinkHost)
          ) {
            sendResponse(
              buildSaveError(
                "Post host does not match current page host.",
                "UNSUPPORTED_HOST"
              )
            );
            return;
          }

          const result = await saveToTeak({
            content: postRequest.payload.permalink,
            enforceAllowedHosts: platformRule.permalinkPolicy === "same-host",
            source: "inline-post",
          });
          void captureSaveResult(result, "inline-post", "url");
          sendResponse(result);
          return;
        }
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "Unexpected save failure";
        sendResponse(buildSaveError(messageText));
      }
    })();

    return true;
  }

  // Initialize context menus immediately
  void createContextMenus();
});
