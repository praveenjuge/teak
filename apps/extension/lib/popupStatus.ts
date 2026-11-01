import { CARD_ERROR_CODES } from "@teak/convex/shared/constants";
import type { TeakTranslator } from "@teak/i18n";
import type { AutoSaveState } from "../hooks/useAutoSaveUrl";
import type { ContextMenuSaveState } from "../types/contextMenu";
import type { TeakSaveResponse } from "../types/messages";

export type FileUploadState =
  | "duplicate"
  | "error"
  | "idle"
  | "saving"
  | "success";

export type PopupTone =
  | "error"
  | "existing"
  | "info"
  | "loading"
  | "success"
  | "upgrade";

export interface PopupStatus {
  autoClose: boolean;
  detail?: string;
  title: string;
  tone: PopupTone;
}

export type PopupStatusStrings = TeakTranslator<"extension.popup.status">;

export interface PopupStatusInput {
  autoSave: {
    code?: string;
    error?: string;
    state: AutoSaveState;
    url?: string;
  };
  contextMenu?: ContextMenuSaveState;
  detailsTouched?: boolean;
  fileUpload: {
    code?: string;
    error?: string;
    fileName?: string;
    state: FileUploadState;
  };
}

const isCardLimitError = (code?: string) =>
  code === CARD_ERROR_CODES.CARD_LIMIT_REACHED;

const errorStatus = (
  t: PopupStatusStrings,
  title: string,
  message?: string,
  code?: string
): PopupStatus =>
  isCardLimitError(code)
    ? {
        autoClose: false,
        detail: t("upgradeForUnlimited"),
        title: t("freeLimitReached"),
        tone: "upgrade",
      }
    : { autoClose: false, detail: message, title, tone: "error" };

export const uploadPromptStatus = (t: PopupStatusStrings): PopupStatus => ({
  autoClose: false,
  detail: t("fileSizeLimit"),
  title: t("chooseFile"),
  tone: "info",
});

const hostOf = (url?: string): string | undefined => {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

const CONTEXT_MENU_SAVED_TITLES = {
  "save-asset": "savedToTeak",
  "save-page": "pageSaved",
  "save-text": "textSaved",
} as const;

export function toContextMenuStatus(
  result: TeakSaveResponse
): Exclude<ContextMenuSaveState["status"], "idle" | "saving"> {
  if (result.status === "saved") {
    return "success";
  }
  return result.status === "duplicate" ? "duplicate" : "error";
}

export function getPopupStatus(
  input: PopupStatusInput,
  t: PopupStatusStrings
): PopupStatus | null {
  const status = baseStatus(input, t);
  return status && input.detailsTouched
    ? { ...status, autoClose: false }
    : status;
}

function baseStatus(
  { autoSave, contextMenu, fileUpload }: PopupStatusInput,
  t: PopupStatusStrings
): PopupStatus | null {
  switch (fileUpload.state) {
    case "saving":
      return {
        autoClose: false,
        detail: fileUpload.fileName,
        title: t("uploadingFile"),
        tone: "loading",
      };
    case "success":
      return {
        autoClose: true,
        detail: fileUpload.fileName,
        title: t("fileSaved"),
        tone: "success",
      };
    case "duplicate":
      return {
        autoClose: false,
        detail: fileUpload.fileName,
        title: t("alreadySaved"),
        tone: "existing",
      };
    case "error":
      return errorStatus(
        t,
        t("uploadFailed"),
        fileUpload.error,
        fileUpload.code
      );
    default:
      break;
  }

  if (contextMenu && contextMenu.status !== "idle") {
    switch (contextMenu.status) {
      case "saving":
        return {
          autoClose: false,
          title: t("savingToTeak"),
          tone: "loading",
        };
      case "success":
        return {
          autoClose: true,
          title: t(
            CONTEXT_MENU_SAVED_TITLES[contextMenu.action ?? "save-asset"]
          ),
          tone: "success",
        };
      case "duplicate":
        return {
          autoClose: false,
          title: t("alreadySaved"),
          tone: "existing",
        };
      default:
        return errorStatus(
          t,
          t("saveFailed"),
          contextMenu.error,
          contextMenu.code
        );
    }
  }

  const host = hostOf(autoSave.url);
  switch (autoSave.state) {
    case "loading":
      return {
        autoClose: false,
        detail: host,
        title: t("savingPage"),
        tone: "loading",
      };
    case "success":
      return {
        autoClose: true,
        detail: host,
        title: t("savedToTeak"),
        tone: "success",
      };
    case "duplicate":
      return {
        autoClose: false,
        detail: host,
        title: t("alreadySaved"),
        tone: "existing",
      };
    case "error":
      return errorStatus(t, t("pageSaveFailed"), autoSave.error, autoSave.code);
    case "invalid-url":
      return {
        autoClose: false,
        detail: t("cantSavePageDetail"),
        title: t("cantSavePage"),
        tone: "info",
      };
    default:
      return null;
  }
}

/** What the popup is saving or just saved: the current page, or a chosen file. */
export type SavedItem =
  | { kind: "page"; favIconUrl?: string; title?: string; url: string }
  | { kind: "file"; mimeType: string; name: string; size: number };

const PAGE_PREVIEW_STATES = new Set<AutoSaveState>([
  "loading",
  "success",
  "duplicate",
]);

/**
 * The page or file to preview under the status line: the chosen file while it
 * uploads or once it's saved, otherwise the current page while it's saving or
 * saved. Errors, prompts and context-menu saves show on their own.
 */
export function previewItem({
  autoSave,
  chosenFile,
  fileState,
  isRecentSave,
  status,
}: {
  autoSave: {
    state: AutoSaveState;
    tab?: { favIconUrl?: string; title?: string };
    url?: string;
  };
  chosenFile?: SavedItem;
  fileState: FileUploadState;
  isRecentSave: boolean;
  status: PopupStatus | null;
}): SavedItem | undefined {
  if (!status || status.tone === "error" || status.tone === "upgrade") {
    return undefined;
  }
  if (fileState !== "idle") {
    return chosenFile;
  }
  if (
    isRecentSave ||
    !autoSave.url ||
    !PAGE_PREVIEW_STATES.has(autoSave.state)
  ) {
    return undefined;
  }
  return { kind: "page", url: autoSave.url, ...autoSave.tab };
}
