import {
  FILES_EXTRACTED_TEXT_MAX_CHARACTERS,
  FILES_PDF_TEXT_MAX_PAGES,
} from "@teak/files-protocol";

// Pure helpers for a card's extracted document text, shared by Convex
// (card/documentText.ts) and the Files Worker's card processing, which
// stores the text.

/** Bytes of extracted text that search covers. */
export const SEARCH_PREFIX_MAX_BYTES = 32 * 1024;

const encoder = new TextEncoder();

/** The start of `text` that fits in `maxBytes` of UTF-8, whole characters. */
export const searchPrefix = (
  text: string,
  maxBytes = SEARCH_PREFIX_MAX_BYTES
): string => {
  if (encoder.encode(text).byteLength <= maxBytes) {
    return text;
  }
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const size = encoder.encode(character).byteLength;
    if (bytes + size > maxBytes) {
      break;
    }
    bytes += size;
    end += character.length;
  }
  return text.slice(0, end);
};

/**
 * Whether the Files Worker stopped before the end of the document: it read
 * its whole budget, or the PDF has pages past the ones it reads. Only PDFs
 * report a page count, and only their budget counts characters.
 */
export const isExtractedTextTruncated = (
  text: string,
  pageCount?: number
): boolean =>
  text.length >= FILES_EXTRACTED_TEXT_MAX_CHARACTERS ||
  (pageCount === undefined &&
    encoder.encode(text).byteLength >= FILES_EXTRACTED_TEXT_MAX_CHARACTERS) ||
  (pageCount ?? 0) > FILES_PDF_TEXT_MAX_PAGES;

/**
 * `<user key prefix>/<card id>/document-text/<sha-256>.txt`, where the user
 * key prefix is `filesCardKeyPrefix(envPrefix, userId)`.
 */
export const documentTextObjectKey = (
  userKeyPrefix: string,
  cardId: string,
  digest: string
): string => {
  if (!(/^[a-f0-9]{64}$/.test(digest) && /^[a-z0-9]+$/i.test(cardId))) {
    throw new Error("document_text_invalid_key");
  }
  return `${userKeyPrefix}/${cardId}/document-text/${digest}.txt`;
};
