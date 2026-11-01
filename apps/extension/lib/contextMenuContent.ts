import type { TeakSaveResponse } from "../types/messages";
import type { PendingSave } from "./pendingSaves";
import {
  ASSET_IS_PAGE,
  ASSET_REDIRECTED,
  type FileUploadInput,
  WEB_PAGE_TYPE,
} from "./saveFileToTeak";

type AssetSave = Extract<PendingSave, { kind: "asset" }>;

export const assetSaveFor = (info: {
  linkUrl?: string;
  srcUrl?: string;
}): Pick<AssetSave, "assetUrl" | "link"> | null => {
  if (info.srcUrl) {
    return { assetUrl: info.srcUrl };
  }
  return info.linkUrl ? { assetUrl: info.linkUrl, link: true } : null;
};

export const isWebPageFile = (file: Pick<FileUploadInput, "mimeType">) =>
  WEB_PAGE_TYPE.test(file.mimeType ?? "");

/**
 * Whether a plain link's download means the link itself is the thing to
 * save: it was a page (even one refusing an anonymous fetch), or it
 * redirected (as most page links do). Any other
 * failure stays a failure, so a retry can still fetch the file.
 */
export const savesLinkInstead = (
  download: FileUploadInput | TeakSaveResponse
): boolean =>
  "status" in download
    ? download.status === "error" &&
      (download.code === ASSET_REDIRECTED || download.code === ASSET_IS_PAGE)
    : isWebPageFile(download);

/**
 * The selection to save. The page's own selection keeps its line breaks;
 * the menu's `selectionText` (Chromium collapses them) is the fallback.
 */
export const pickSelectedText = (
  fromPage: unknown,
  selectionText: string | undefined
): string | null => {
  if (typeof fromPage === "string" && fromPage.trim()) {
    return fromPage;
  }
  return selectionText?.trim() ? selectionText : null;
};
