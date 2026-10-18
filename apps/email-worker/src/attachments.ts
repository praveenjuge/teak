import type { Attachment, Email } from "postal-mime";

// Which parts of a message become their own file cards. Signatures, calendar
// invites, Outlook's winmail.dat and small images the HTML shows inline (logos,
// spacers) are left out; Convex then checks each file's format and size like
// any upload.

export const MAX_ATTACHMENTS = 50;
/** An inline image the HTML references and smaller than this is decoration. */
export const DECORATION_MAX_BYTES = 16 * 1024;

const SKIPPED_TYPES = new Set([
  "application/ms-tnef",
  "application/pkcs7-signature",
  "application/vnd.ms-tnef",
  "application/x-pkcs7-signature",
  "text/calendar",
]);

const SKIPPED_NAMES = new Set(["smime.p7s", "winmail.dat"]);

/** Extensions for a part that has no file name of its own. */
const EXTENSIONS: Record<string, string> = {
  "application/msword": "doc",
  "application/pdf": "pdf",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/zip": "zip",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "text/csv": "csv",
  "text/markdown": "md",
  "text/plain": "txt",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export interface SelectedAttachment {
  content: Uint8Array<ArrayBuffer>;
  fileName: string;
  index: number;
  mimeType: string;
  size: number;
}

const CID_REFERENCE_REGEX = /cid:([^"'\s)>]+)/gi;

const referencedContentIds = (html: string | undefined): Set<string> => {
  const ids = new Set<string>();
  for (const match of (html ?? "").matchAll(CID_REFERENCE_REGEX)) {
    if (match[1]) {
      let id = match[1];
      try {
        id = decodeURIComponent(id);
      } catch {
        // A malformed escape keeps the reference as written.
      }
      ids.add(id.toLowerCase());
    }
  }
  return ids;
};

const baseMimeType = (value: string | undefined): string =>
  (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

const contentBytes = (attachment: Attachment): Uint8Array<ArrayBuffer> => {
  const { content } = attachment;
  if (typeof content === "string") {
    if (attachment.encoding === "base64") {
      return Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
    }
    return new TextEncoder().encode(content);
  }
  return new Uint8Array(content);
};

const isKnownFileType = (mimeType: string): boolean =>
  mimeType in EXTENSIONS ||
  mimeType.startsWith("image/") ||
  mimeType.startsWith("audio/") ||
  mimeType.startsWith("video/");

export const selectAttachments = (
  email: Pick<Email, "attachments" | "html">
): SelectedAttachment[] => {
  const inlineIds = referencedContentIds(email.html);
  const selected: SelectedAttachment[] = [];
  for (const attachment of email.attachments) {
    if (selected.length >= MAX_ATTACHMENTS) {
      break;
    }
    const mimeType = baseMimeType(attachment.mimeType);
    const name = attachment.filename?.trim() || null;
    if (
      SKIPPED_TYPES.has(mimeType) ||
      (name && SKIPPED_NAMES.has(name.toLowerCase()))
    ) {
      continue;
    }
    if (!(name || isKnownFileType(mimeType))) {
      continue;
    }
    const content = contentBytes(attachment);
    if (content.byteLength === 0) {
      continue;
    }
    const contentId = attachment.contentId
      ?.replace(/^<|>$/g, "")
      .trim()
      .toLowerCase();
    if (
      mimeType.startsWith("image/") &&
      contentId &&
      inlineIds.has(contentId) &&
      content.byteLength < DECORATION_MAX_BYTES
    ) {
      continue;
    }
    const index = selected.length;
    selected.push({
      content,
      fileName:
        name ??
        `attachment-${index + 1}.${EXTENSIONS[mimeType] ?? mimeType.split("/")[1] ?? "bin"}`,
      index,
      mimeType: mimeType || "application/octet-stream",
      size: content.byteLength,
    });
  }
  return selected;
};
