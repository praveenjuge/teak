import type { PendingSave } from "./pendingSaves";
import type { FileUploadInput } from "./saveFileToTeak";

type AssetSave = Extract<PendingSave, { kind: "asset" }>;

/**
 * What "Save Asset" saves: the image, video or audio clicked, or the file a
 * plain link points to. A plain link is marked, so a page behind it is saved
 * as a link instead of as its HTML.
 */
export const assetSaveFor = (info: {
  linkUrl?: string;
  srcUrl?: string;
}): Pick<AssetSave, "assetUrl" | "link"> | null => {
  if (info.srcUrl) {
    return { assetUrl: info.srcUrl };
  }
  return info.linkUrl ? { assetUrl: info.linkUrl, link: true } : null;
};

const WEB_PAGE_TYPE = /^\s*(?:text\/html|application\/xhtml\+xml)\b/iu;

/** A download that is a web page, not a file worth keeping as one. */
export const isWebPageFile = (file: Pick<FileUploadInput, "mimeType">) =>
  WEB_PAGE_TYPE.test(file.mimeType ?? "");

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
