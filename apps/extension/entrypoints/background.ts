import {
  beginOAuthSignIn,
  getCaptureOwner,
  getOAuthState,
  initializeAuth,
  oauthRequest,
  signOutOAuth,
} from "../lib/oauthAuth";
import {
  getPendingSave,
  listPendingSaveIds,
  type PendingSave,
  removePendingSave,
  storePendingSave,
  updatePendingSave,
} from "../lib/pendingSaves";
import { downloadAssetFile, saveFileToTeak } from "../lib/saveFileToTeak";
import { saveToTeak } from "../lib/saveToTeak";
import type { ContextMenuAction } from "../types/contextMenu";
import {
  type AuthStateResponse,
  MESSAGE_TYPES,
  type SaveAssetRequest,
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

const runningSaves = new Map<string, Promise<TeakSaveResponse>>();

function runPendingSave(
  pending: PendingSave,
  interactive: boolean
): Promise<TeakSaveResponse> {
  let save = pending;
  const existing = runningSaves.get(save.id);
  if (existing) {
    return existing;
  }
  const operation = (async () => {
    const capture = async (): Promise<TeakSaveResponse> => {
      // The API remembers operation IDs for 24 hours. Stop uncertain retries
      // before that expires so a lost response cannot create a second card.
      if (
        save.firstAttemptAt &&
        Date.now() - save.firstAttemptAt >= 23 * 60 * 60 * 1000
      ) {
        return buildSaveError(
          "This save is too old to retry safely. Check your library before discarding it and saving again.",
          "RETRY_EXPIRED"
        );
      }
      const state = await getOAuthState();
      if (!(state.authenticated && state.user)) {
        return { status: "unauthenticated" };
      }
      if (save.ownerId && save.ownerId !== state.user.id) {
        return buildSaveError(
          "Sign in to the original account to finish this pending save.",
          "ACCOUNT_MISMATCH"
        );
      }
      if (!save.ownerId) {
        save.ownerId = state.user.id;
        await updatePendingSave(save);
      }
      if (!save.firstAttemptAt) {
        save.firstAttemptAt = Date.now();
        await updatePendingSave(save);
      }
      const ownerId = save.ownerId;
      const request = (path: string, init?: RequestInit) =>
        oauthRequest(path, init, ownerId);
      if (save.kind === "content") {
        return saveToTeak(
          { ...save.input, idempotencyKey: save.id },
          { request }
        );
      }
      if (save.kind === "asset") {
        const file = await downloadAssetFile(save.assetUrl);
        if ("status" in file) {
          return file;
        }
        save = {
          id: save.id,
          createdAt: save.createdAt,
          firstAttemptAt: save.firstAttemptAt,
          ownerId: save.ownerId,
          kind: "file",
          input: file,
        };
        await updatePendingSave(save);
      }
      const fileSave = save;
      return saveFileToTeak(
        { ...fileSave.input, idempotencyKey: fileSave.id },
        {
          request,
          onUploaded: async (uploaded) => {
            fileSave.input.uploaded = uploaded;
            await updatePendingSave(fileSave);
          },
        }
      );
    };
    let result = await capture();
    if (result.status === "unauthenticated" && interactive) {
      await beginOAuthSignIn();
      result = await capture();
    }
    const permanentCodes = [
      "EMPTY_CONTENT",
      "UNSUPPORTED_HOST",
      "UNSAFE_ASSET_URL",
      "UNSUPPORTED_TYPE",
      "FILE_TOO_LARGE",
      "INVALID_FILE_NAME",
      "INVALID_INPUT",
      "CONTENT_TOO_LARGE",
    ];
    if (
      result.status === "saved" ||
      result.status === "duplicate" ||
      (result.status === "error" && permanentCodes.includes(result.code ?? ""))
    ) {
      await removePendingSave(save.id);
    }
    await chrome.storage.local.set({
      contextMenuSave: {
        action: save.kind === "content" ? "save-page" : "save-asset",
        timestamp: Date.now(),
        status:
          result.status === "saved" || result.status === "duplicate"
            ? "success"
            : "error",
        error:
          result.status === "error"
            ? result.message
            : (result.status === "unauthenticated" &&
                "Reconnect to finish your pending save.") ||
              undefined,
      },
    });
    return result;
  })().finally(() => runningSaves.delete(save.id));
  runningSaves.set(save.id, operation);
  return operation;
}

async function queueSave(
  input:
    | { kind: "content"; input: Parameters<typeof saveToTeak>[0] }
    | { kind: "asset"; assetUrl: string }
) {
  const save: PendingSave = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ownerId: await getCaptureOwner(),
  };
  await storePendingSave(save);
  return runPendingSave(save, true);
}

async function resumePendingSaves() {
  for (const id of await listPendingSaveIds()) {
    const save = await getPendingSave(id);
    if (!save) {
      continue;
    }
    const result = await runPendingSave(save, false);
    if (result.status === "unauthenticated") {
      break;
    }
  }
}

// Check if a URL is restricted (can't inject scripts)
function isRestrictedUrl(url?: string): boolean {
  if (!url) {
    return true;
  }

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
        return info.selectionText;
      }

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const selection = window.getSelection();
            const selectedText = selection?.toString() ?? "";
            return selectedText.trim() ? selectedText : document.title || "";
          },
        });

        const content = results[0]?.result;
        if (typeof content === "string" && content.trim()) {
          return content;
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
  const { type, payload } = message as { type?: unknown; payload?: unknown };
  if (
    [
      MESSAGE_TYPES.GET_AUTH_STATE,
      MESSAGE_TYPES.SIGN_IN,
      MESSAGE_TYPES.SIGN_OUT,
      MESSAGE_TYPES.RETRY_PENDING,
      MESSAGE_TYPES.DISCARD_PENDING,
    ].some((value) => value === type)
  ) {
    return true;
  }
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const value = payload as Record<string, unknown>;
  const boundedString = (
    candidate: unknown,
    limit: number
  ): candidate is string =>
    typeof candidate === "string" &&
    candidate.length > 0 &&
    candidate.length <= limit;
  switch (type) {
    case MESSAGE_TYPES.SAVE_FILE:
      return boundedString(value.id, 128);
    case MESSAGE_TYPES.SAVE_CONTENT:
      return (
        boundedString(value.content, 512 * 1024) &&
        ["popup-auto-save", "context-menu"].includes(String(value.source))
      );
    case MESSAGE_TYPES.SAVE_ASSET:
      return boundedString(value.assetUrl, 8192);
    case MESSAGE_TYPES.SAVE_POST:
      return (
        boundedString(value.permalink, 8192) &&
        boundedString(value.platform, 64) &&
        boundedString(value.postKey, 8192)
      );
    default:
      return false;
  }
};

export default defineBackground(() => {
  void initializeAuth()
    .then(resumePendingSaves)
    .catch(() => {});
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
        id: "save-asset",
        title: "Save Asset to Teak",
        contexts: ["image", "video", "audio", "link"],
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

      const content =
        action === "save-asset"
          ? info.srcUrl || info.linkUrl || ""
          : await extractContextMenuContent(action, info, tab);
      if (!content) {
        throw new Error("Could not access the selected asset URL");
      }

      // Store content for processing
      const contextMenuState = {
        action,
        timestamp: Date.now(),
        status: "saving",
      };

      await chrome.storage.local.set({
        contextMenuSave: contextMenuState,
      });

      const saveResult =
        action === "save-asset"
          ? await queueSave({ kind: "asset", assetUrl: content })
          : await queueSave({
              kind: "content",
              input: { content, source: "context-menu" },
            });
      if (saveResult.status === "unauthenticated") {
        // Clear the "saving" state and send the user to the sign-in tab rather
        // than surfacing an auth error in the popup.
        await chrome.storage.local.remove("contextMenuSave");
        void chrome.action.openPopup();
        return;
      }

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
      return;
    }
    const trustedPopup =
      sender.id === chrome.runtime.id &&
      sender.url === chrome.runtime.getURL("popup.html");
    const ownPage =
      sender.id === chrome.runtime.id &&
      Boolean(sender.tab?.id) &&
      Boolean(
        sender.url?.startsWith("https://") || sender.url?.startsWith("http://")
      );
    if (
      !(
        trustedPopup ||
        (ownPage &&
          (message.type === MESSAGE_TYPES.SAVE_POST ||
            message.type === MESSAGE_TYPES.GET_AUTH_STATE))
      )
    ) {
      sendResponse(
        buildSaveError("This action is only available in the Teak popup.")
      );
      return;
    }

    void (async () => {
      try {
        await initializeAuth();
        if (
          message.type === MESSAGE_TYPES.RETRY_PENDING ||
          message.type === MESSAGE_TYPES.DISCARD_PENDING
        ) {
          if (message.type === MESSAGE_TYPES.RETRY_PENDING) {
            if (!(await getOAuthState()).authenticated) {
              await beginOAuthSignIn();
            }
            await resumePendingSaves();
          } else {
            if (runningSaves.size) {
              throw new Error(
                "Wait for the current save to finish, then discard pending saves."
              );
            }
            for (const id of await listPendingSaveIds()) {
              await removePendingSave(id);
            }
          }
          sendResponse({
            ...(await getOAuthState()),
            pendingCount: (await listPendingSaveIds()).length,
          });
          return;
        }
        if (
          message.type === MESSAGE_TYPES.SIGN_IN ||
          message.type === MESSAGE_TYPES.SIGN_OUT ||
          message.type === MESSAGE_TYPES.SAVE_FILE
        ) {
          if (!trustedPopup) {
            sendResponse(
              buildSaveError("This action is only available in the Teak popup.")
            );
            return;
          }
          if (message.type === MESSAGE_TYPES.SAVE_FILE) {
            const save = await getPendingSave(message.payload.id);
            if (save?.kind !== "file") {
              throw new Error("Pending file not found.");
            }
            if (!save.ownerId) {
              save.ownerId = await getCaptureOwner();
              await updatePendingSave(save);
            }
            sendResponse(await runPendingSave(save, true));
            return;
          }
          if (message.type === MESSAGE_TYPES.SIGN_OUT) {
            await signOutOAuth();
          } else {
            await beginOAuthSignIn();
            await resumePendingSaves();
          }
          sendResponse({
            ...(await getOAuthState()),
            pendingCount: (await listPendingSaveIds()).length,
          });
          return;
        }
        if (message.type === MESSAGE_TYPES.GET_AUTH_STATE) {
          const state = await getOAuthState();
          sendResponse(
            trustedPopup
              ? { ...state, pendingCount: (await listPendingSaveIds()).length }
              : { authenticated: state.authenticated }
          );
          return;
        }

        if (message.type === MESSAGE_TYPES.SAVE_CONTENT) {
          const saveRequest = message as SaveContentRequest;
          const result = await queueSave({
            kind: "content",
            input: {
              content: saveRequest.payload.content,
              source: saveRequest.payload.source,
            },
          });
          if (result.status === "unauthenticated") {
            void chrome.action.openPopup();
          }
          sendResponse(result);
          return;
        }

        if (message.type === MESSAGE_TYPES.SAVE_ASSET) {
          const saveRequest = message as SaveAssetRequest;
          const result = await queueSave({
            kind: "asset",
            assetUrl: saveRequest.payload.assetUrl,
          });
          if (result.status === "unauthenticated") {
            void chrome.action.openPopup();
          }
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

          const result = await queueSave({
            kind: "content",
            input: {
              content: postRequest.payload.permalink,
              enforceAllowedHosts: platformRule.permalinkPolicy === "same-host",
              source: "inline-post",
            },
          });
          if (result.status === "unauthenticated") {
            void chrome.action.openPopup();
          }
          sendResponse(result);
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
