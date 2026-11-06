import {
  extensionForMimeType,
  normalizeMimeType,
} from "@teak/convex/shared/fileFormats";
import type { Attachment, Email } from "postal-mime";

export const MAX_ATTACHMENTS = 50;
export const DECORATION_MAX_BYTES = 16 * 1024;

const SKIPPED_TYPES = new Set([
  "application/ms-tnef",
  "application/pkcs7-signature",
  "application/vnd.ms-tnef",
  "application/x-pkcs7-signature",
  "text/calendar",
]);

const SKIPPED_NAMES = new Set(["smime.p7s", "winmail.dat"]);

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

const contentBytes = (attachment: Attachment): Uint8Array<ArrayBuffer> => {
  const { content } = attachment;
  if (typeof content === "string") {
    if (attachment.encoding === "base64") {
      return Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
    }
    // Workers types give encode() an ArrayBufferLike; copy it into its own.
    return Uint8Array.from(new TextEncoder().encode(content));
  }
  return new Uint8Array(content);
};

const isKnownFileType = (mimeType: string): boolean =>
  extensionForMimeType(mimeType) !== undefined ||
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
    const mimeType = normalizeMimeType(attachment.mimeType);
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
        `attachment-${index + 1}.${extensionForMimeType(mimeType) ?? mimeType.split("/")[1] ?? "bin"}`,
      index,
      mimeType: mimeType || "application/octet-stream",
      size: content.byteLength,
    });
  }
  return selected;
};
