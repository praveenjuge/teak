import { CARD_ERROR_CODES } from "@teak/convex/shared/constants";
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

export interface PopupStatusInput {
  autoSave: {
    code?: string;
    error?: string;
    state: AutoSaveState;
    url?: string;
  };
  contextMenu?: ContextMenuSaveState;
  /** Someone started adding tags or a note: the popup stays open. */
  detailsTouched?: boolean;
  fileUpload: {
    code?: string;
    error?: string;
    fileName?: string;
    state: FileUploadState;
  };
}

const UPGRADE_STATUS: PopupStatus = {
  autoClose: false,
  detail: "Upgrade to Pro for unlimited cards.",
  title: "You've reached the free limit",
  tone: "upgrade",
};

// The REST API sends the code beside its message; older saves carried it in
// the message.
const isCardLimitError = (message?: string, code?: string) =>
  code === CARD_ERROR_CODES.CARD_LIMIT_REACHED ||
  Boolean(message?.includes(CARD_ERROR_CODES.CARD_LIMIT_REACHED));

const errorStatus = (
  title: string,
  message?: string,
  code?: string
): PopupStatus =>
  isCardLimitError(message, code)
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

export function toContextMenuStatus(
  result: TeakSaveResponse
): Exclude<ContextMenuSaveState["status"], "idle" | "saving"> {
  if (result.status === "saved") {
    return "success";
  }
  return result.status === "duplicate" ? "duplicate" : "error";
}

export function getPopupStatus(input: PopupStatusInput): PopupStatus | null {
  const status = baseStatus(input);
  return status && input.detailsTouched
    ? { ...status, autoClose: false }
    : status;
}

function baseStatus({
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
      return errorStatus(
        "Couldn't upload file",
        fileUpload.error,
        fileUpload.code
      );
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
        return errorStatus(
          "Couldn't save",
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
      return errorStatus(
        "Couldn't save this page",
        autoSave.error,
        autoSave.code
      );
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
