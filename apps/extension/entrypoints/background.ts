import { API_IDEMPOTENCY_KEY_TTL_MS } from "@teak/convex/shared/constants";
import { APP_URL } from "../lib/appUrl";
import { getCaptureOwner } from "../lib/captureOwner";
import {
  createDraftKeeper,
  createPatchQueue,
  loadSaveDetails,
} from "../lib/cardDetails";
import { isCardId, isPatchCardPayload } from "../lib/cardPatch";
import {
  assetSaveFor,
  isWebPageFile,
  pickSelectedText,
} from "../lib/contextMenuContent";
import {
  beginOAuthSignIn,
  getOAuthState,
  initializeAuth,
  oauthRequest,
  signOutOAuth,
} from "../lib/oauthAuth";
import {
  buildSuggestions,
  cardUrlFrom,
  createOmniboxSearch,
  defaultSuggestion,
  noticeRow,
  type OmniboxFlavor,
  type OmniboxOutcome,
  searchOmnibox,
  searchUrl,
  stillSignedOut,
} from "../lib/omnibox";
import {
  getPendingSave,
  listPendingSaveIds,
  type PendingSave,
  pendingSaveStore,
  removePendingSave,
  storePendingSave,
  updatePendingSave,
  waitingSaveIds,
} from "../lib/pendingSaves";
import { toContextMenuStatus } from "../lib/popupStatus";
import { isPrivateSession } from "../lib/privateSession";
import { clearRecentTags, rememberTags } from "../lib/recentTags";
import { isRestrictedUrl, restrictedUrlMessage } from "../lib/restrictedUrl";
import { downloadAssetFile, saveFileToTeak } from "../lib/saveFileToTeak";
import { saveToTeak } from "../lib/saveToTeak";
import { captureExtensionEvent, reportUncaughtErrors } from "../lib/telemetry";
import type { ContextMenuAction } from "../types/contextMenu";
import {
  type AuthStateResponse,
  type CardPatchResponse,
  MESSAGE_TYPES,
  type PatchCardPayload,
  SAVE_DETAILS_PORT,
  type SaveAssetRequest,
  type SaveContentRequest,
  type SaveDetailsResponse,
  type SavePostRequest,
  type TeakRuntimeRequest,
  type TeakSaveResponse,
} from "../types/messages";
import {
  getInlineSavePlatformRule,
  isInlineSavePermalinkAllowed,
  isSupportedInlineSaveHost,
} from "../types/social";

/** The popup, or in Firefox its upload window (`popup.html#upload`). */
const isPopupPage = (url: string | undefined) =>
  url?.split("#")[0] === chrome.runtime.getURL("popup.html");

const runningSaves = new Map<string, Promise<TeakSaveResponse>>();
const queuePatch = createPatchQueue();

async function patchCard(payload: PatchCardPayload) {
  const result = await queuePatch(payload);
  const owner = await getCaptureOwner();
  if (result.status === "updated" && payload.addedTags && owner) {
    await rememberTags(owner, payload.addedTags);
  }
  return result;
}
const RETRY_SAFE_WINDOW_MS = API_IDEMPOTENCY_KEY_TTL_MS - 60 * 60 * 1000;

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
      if (
        save.firstAttemptAt &&
        Date.now() - save.firstAttemptAt >= RETRY_SAFE_WINDOW_MS
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
      if (!(save.ownerId && save.firstAttemptAt)) {
        save.ownerId ??= state.user.id;
        save.firstAttemptAt ??= Date.now();
        await updatePendingSave(save);
        // Firefox can't read a stored file through a Blob read before its
        // record was rewritten, so read the record again.
        save = (await getPendingSave(save.id)) ?? save;
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
      const keepsFile = pendingSaveStore().retainsFiles;
      if (save.kind === "asset") {
        const file = await downloadAssetFile(save.assetUrl);
        // A plain link to a page (or one that redirects) saves as a link.
        if (save.link && ("status" in file || isWebPageFile(file))) {
          return saveToTeak(
            {
              content: save.assetUrl,
              idempotencyKey: save.id,
              source: "context-menu",
            },
            { request }
          );
        }
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
        if (keepsFile) {
          await updatePendingSave(save);
        }
      }
      const fileSave = save;
      return saveFileToTeak(
        { ...fileSave.input, idempotencyKey: fileSave.id },
        {
          request,
          onUploaded: async (uploaded) => {
            fileSave.input.uploaded = uploaded;
            if (keepsFile) {
              await updatePendingSave(fileSave);
            }
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
    if (result.status === "saved") {
      await captureExtensionEvent("extension_card_saved", { via: save.kind });
    }
    if (
      result.status === "saved" ||
      result.status === "duplicate" ||
      (result.status === "error" &&
        permanentCodes.includes(result.code ?? "")) ||
      (pending.kind === "file" && !pendingSaveStore().retainsFiles)
    ) {
      await removePendingSave(save.id);
    }
    return result;
  })().finally(() => runningSaves.delete(save.id));
  runningSaves.set(save.id, operation);
  return operation;
}

async function queueSave(
  input:
    | { kind: "content"; input: Parameters<typeof saveToTeak>[0] }
    | { kind: "asset"; assetUrl: string; link?: true }
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

async function resumePendingSaves(): Promise<TeakSaveResponse | undefined> {
  let failure: TeakSaveResponse | undefined;
  for (const id of await listPendingSaveIds()) {
    const save = await getPendingSave(id);
    if (!save) {
      continue;
    }
    const result = await runPendingSave(save, false);
    if (result.status === "saved" || result.status === "duplicate") {
      continue;
    }
    failure ??= result;
    if (result.status === "unauthenticated") {
      break;
    }
  }
  return failure;
}

const listWaitingSaveIds = async () =>
  waitingSaveIds(await listPendingSaveIds(), runningSaves);

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

      const results = await chrome.scripting
        .executeScript({
          target:
            info.frameId === undefined
              ? { tabId: tab.id }
              : { tabId: tab.id, frameIds: [info.frameId] },
          func: () => window.getSelection()?.toString() ?? "",
        })
        .catch(() => []);
      const content = pickSelectedText(results[0]?.result, info.selectionText);
      if (content) {
        return content;
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
      return (
        boundedString(value.id, 128) &&
        (!("file" in value) || value.file instanceof File)
      );
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
    case MESSAGE_TYPES.PATCH_CARD:
      return isPatchCardPayload(value);
    case MESSAGE_TYPES.LOAD_SAVE_DETAILS:
      return isCardId(value.cardId) && typeof value.alreadySaved === "boolean";
    default:
      return false;
  }
};

export default defineBackground(() => {
  reportUncaughtErrors(self, "background");
  void initializeAuth()
    .then(resumePendingSaves)
    .catch(() => undefined);
  chrome.runtime.onStartup.addListener(createContextMenus);
  chrome.runtime.onInstalled.addListener(createContextMenus);

  chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  chrome.runtime.onConnect.addListener(handleSaveDetailsPort);
  listenToOmnibox();

  function listenToOmnibox() {
    const flavor: OmniboxFlavor =
      import.meta.env.BROWSER === "firefox" ? "firefox" : "chromium";
    let suggest:
      | ((suggestions: chrome.omnibox.SuggestResult[]) => void)
      | undefined;
    let signedOut = false;
    const showDefault = (outcome: OmniboxOutcome) =>
      chrome.omnibox.setDefaultSuggestion({
        description: defaultSuggestion(
          signedOut ? { kind: "signedOut" } : outcome,
          flavor
        ),
      });
    const search = createOmniboxSearch({
      search: (text, signal) =>
        searchOmnibox(text, signal, (path, init) => oauthRequest(path, init)),
      show: (text, outcome) => {
        signedOut = stillSignedOut(signedOut, outcome);
        showDefault(outcome);
        if (outcome.kind === "results") {
          suggest?.(buildSuggestions(outcome.cards, flavor));
          return;
        }
        const notice = noticeRow(
          signedOut ? { kind: "signedOut" } : outcome,
          text,
          flavor
        );
        suggest?.(notice ? [notice] : []);
      },
    });

    chrome.omnibox.onInputStarted.addListener(() => {
      search.reset();
      signedOut = false;
      showDefault({ kind: "short" });
      void getOAuthState()
        .then((state) => {
          if (!state.authenticated) {
            signedOut = true;
            showDefault({ kind: "signedOut" });
          }
        })
        .catch(() => undefined);
    });
    chrome.omnibox.onInputChanged.addListener((text, callback) => {
      suggest = callback;
      search.input(text);
    });
    chrome.omnibox.onInputCancelled.addListener(() => search.reset());
    chrome.omnibox.onInputEntered.addListener((text, disposition) => {
      search.reset();
      suggest = undefined;
      void (async () => {
        const state = await getOAuthState().catch(() => undefined);
        if (state && !state.authenticated) {
          await beginOAuthSignIn().catch(() => undefined);
          return;
        }
        const card = cardUrlFrom(text, APP_URL);
        const url = card ?? searchUrl(APP_URL, text);
        if (disposition === "currentTab") {
          await chrome.tabs.update({ url });
        } else {
          await chrome.tabs.create({
            url,
            active: disposition === "newForegroundTab",
          });
        }
        await captureExtensionEvent("extension_omnibox_used", {
          result: card ? "card" : "search",
        });
      })();
    });
  }

  function handleSaveDetailsPort(port: chrome.runtime.Port) {
    if (
      port.name !== SAVE_DETAILS_PORT ||
      port.sender?.id !== chrome.runtime.id ||
      !isPopupPage(port.sender?.url)
    ) {
      port.disconnect();
      return;
    }
    const keeper = createDraftKeeper(patchCard);
    port.onMessage.addListener((message) => keeper.update(message));
    port.onDisconnect.addListener(() => {
      void keeper.flush().catch(() => undefined);
    });
  }

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

  async function handleContextMenuClick(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab
  ) {
    if (!tab?.id) {
      return;
    }

    const action = info.menuItemId as ContextMenuAction;
    let errorCode: string | undefined;
    // Firefox opens the popup only while the click is being handled, so it
    // opens now and follows the save through storage. The record is queued
    // first, so the popup reads it instead of saving the page itself.
    void chrome.storage.local.set({
      contextMenuSave: { action, timestamp: Date.now(), status: "saving" },
    });
    void chrome.action.openPopup().catch(() => undefined);

    try {
      if (isRestrictedUrl(tab.url)) {
        throw new Error(restrictedUrlMessage(tab.url));
      }

      const asset = action === "save-asset" ? assetSaveFor(info) : null;
      let content = asset?.assetUrl ?? "";
      if (action !== "save-asset") {
        content = await extractContextMenuContent(action, info, tab);
      }
      if (!content) {
        throw new Error("Could not access the selected asset URL");
      }

      const saveResult = asset
        ? await queueSave({ kind: "asset", ...asset })
        : await queueSave({
            kind: "content",
            input: {
              content,
              source: "context-menu",
              ...(action === "save-text"
                ? { sourceTitle: tab.title, sourceUrl: tab.url }
                : {}),
            },
          });
      if (saveResult.status === "unauthenticated") {
        await chrome.storage.local.remove("contextMenuSave");
        return;
      }

      const status = toContextMenuStatus(saveResult);
      if (status === "error") {
        errorCode = saveResult.status === "error" ? saveResult.code : undefined;
        throw new Error(buildContextMenuErrorMessage(saveResult));
      }
      await chrome.storage.local.set({
        contextMenuSave: { action, timestamp: Date.now(), status },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save content";

      await chrome.storage.local.set({
        contextMenuSave: {
          action,
          timestamp: Date.now(),
          status: "error",
          error: errorMessage,
          ...(errorCode ? { code: errorCode } : {}),
        },
      });
    }
  }

  function handleRuntimeMessage(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (
      response?:
        | AuthStateResponse
        | CardPatchResponse
        | SaveDetailsResponse
        | TeakSaveResponse
    ) => void
  ): boolean | undefined {
    if (!isRuntimeRequest(message)) {
      return;
    }
    const trustedPopup =
      sender.id === chrome.runtime.id && isPopupPage(sender.url);
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
            const failure = await resumePendingSaves();
            if (failure) {
              sendResponse(
                failure.status === "error"
                  ? failure
                  : buildSaveError("Sign in to finish your pending saves.")
              );
              return;
            }
          } else {
            for (const id of await listWaitingSaveIds()) {
              await removePendingSave(id);
            }
          }
          sendResponse({
            ...(await getOAuthState()),
            pendingCount: (await listWaitingSaveIds()).length,
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
            const { id } = message.payload;
            if ("file" in message.payload) {
              const { file } = message.payload;
              await storePendingSave({
                id,
                createdAt: Date.now(),
                ownerId: await getCaptureOwner(),
                kind: "file",
                input: {
                  bytes: file,
                  fileName: file.name,
                  mimeType: file.type,
                  source: "popup-file",
                },
              });
            }
            const save = await getPendingSave(id);
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
            await clearRecentTags();
          } else {
            await beginOAuthSignIn();
            await resumePendingSaves();
          }
          sendResponse({
            ...(await getOAuthState()),
            pendingCount: (await listWaitingSaveIds()).length,
          });
          return;
        }
        if (message.type === MESSAGE_TYPES.GET_AUTH_STATE) {
          const state = await getOAuthState();
          sendResponse(
            trustedPopup
              ? {
                  ...state,
                  pendingCount: (await listWaitingSaveIds()).length,
                  ...(isPrivateSession() ? { privateSession: true } : {}),
                }
              : { authenticated: state.authenticated }
          );
          return;
        }

        if (message.type === MESSAGE_TYPES.PATCH_CARD) {
          sendResponse(await patchCard(message.payload));
          return;
        }

        if (message.type === MESSAGE_TYPES.LOAD_SAVE_DETAILS) {
          sendResponse(await loadSaveDetails(message.payload));
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

  void createContextMenus();
});
