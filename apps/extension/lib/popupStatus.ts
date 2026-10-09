import type { AutoSaveState } from "../hooks/useAutoSaveUrl";
import type { ContextMenuSaveState } from "../types/contextMenu";
import type { TeakSaveResponse } from "../types/messages";

// Matches CARD_LIMIT_REACHED in packages/convex/shared/constants.ts.
const CARD_LIMIT_REACHED_CODE = "CARD_LIMIT_REACHED";

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

export interface PopupStatusInput {
  autoSave: { error?: string; state: AutoSaveState; url?: string };
  /** The latest right-click save, only while it is recent enough to report. */
  contextMenu?: ContextMenuSaveState;
  fileUpload: { error?: string; fileName?: string; state: FileUploadState };
}

const UPGRADE_STATUS: PopupStatus = {
  autoClose: false,
  detail: "Upgrade to Pro for unlimited cards.",
  title: "You've reached the free limit",
  tone: "upgrade",
};

const isCardLimitError = (message?: string) =>
  Boolean(message?.includes(CARD_LIMIT_REACHED_CODE));

const errorStatus = (title: string, message?: string): PopupStatus =>
  isCardLimitError(message)
    ? UPGRADE_STATUS
    : { autoClose: false, detail: message, title, tone: "error" };

const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : undefined;
  } catch {}
};

const ALREADY_SAVED_TITLE = "Already in your Teak";

const CONTEXT_MENU_SAVED_TITLES = {
  "save-asset": "Saved to Teak",
  "save-page": "Page saved",
  "save-text": "Text saved",
} as const;

/** Maps a right-click save result to the state the popup reports for it. */
export function toContextMenuStatus(
  result: TeakSaveResponse
): Exclude<ContextMenuSaveState["status"], "idle" | "saving"> {
  if (result.status === "saved") {
    return "success";
  }
  return result.status === "duplicate" ? "duplicate" : "error";
}

/**
 * Decides what the popup shows. A file the user just picked wins, then a
 * recent right-click save, then the automatic save of the current tab.
 */
export function getPopupStatus({
  autoSave,
  contextMenu,
  fileUpload,
}: PopupStatusInput): PopupStatus | null {
  switch (fileUpload.state) {
    case "saving":
      return {
        autoClose: false,
        detail: fileUpload.fileName,
        title: "Uploading file",
        tone: "loading",
      };
    case "success":
      return {
        autoClose: true,
        detail: fileUpload.fileName,
        title: "File saved",
        tone: "success",
      };
    case "duplicate":
      return {
        autoClose: false,
        detail: fileUpload.fileName,
        title: ALREADY_SAVED_TITLE,
        tone: "existing",
      };
    case "error":
      return errorStatus("Couldn't upload file", fileUpload.error);
    default:
      break;
  }

  if (contextMenu && contextMenu.status !== "idle") {
    switch (contextMenu.status) {
      case "saving":
        return { autoClose: false, title: "Saving to Teak", tone: "loading" };
      case "success":
        return {
          autoClose: true,
          title: CONTEXT_MENU_SAVED_TITLES[contextMenu.action ?? "save-asset"],
          tone: "success",
        };
      case "duplicate":
        return {
          autoClose: false,
          title: ALREADY_SAVED_TITLE,
          tone: "existing",
        };
      default:
        return errorStatus("Couldn't save", contextMenu.error);
    }
  }

  const host = hostOf(autoSave.url);
  switch (autoSave.state) {
    case "loading":
      return {
        autoClose: false,
        detail: host,
        title: "Saving page",
        tone: "loading",
      };
    case "success":
      return {
        autoClose: true,
        detail: host,
        title: "Saved to Teak",
        tone: "success",
      };
    case "duplicate":
      return {
        autoClose: false,
        detail: host,
        title: ALREADY_SAVED_TITLE,
        tone: "existing",
      };
    case "error":
      return errorStatus("Couldn't save this page", autoSave.error);
    case "invalid-url":
      return {
        autoClose: false,
        detail: "Open a web page to save it, or upload a file.",
        title: "Can't save this page",
        tone: "info",
      };
    default:
      return null;
  }
}
