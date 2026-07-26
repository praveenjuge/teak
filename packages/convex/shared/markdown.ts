export const MARKDOWN_CONTENT_MAX_BYTES = 512 * 1024;
export const MARKDOWN_CONTENT_TOO_LARGE_MESSAGE =
  "Text card content must not exceed 512 KiB when encoded as UTF-8.";
export const MARKDOWN_INVALID_UTF8_MESSAGE =
  "Markdown uploads must contain valid UTF-8 text.";

export const MARKDOWN_ERROR_CODES = {
  CONTENT_TOO_LARGE: "CONTENT_TOO_LARGE",
  INVALID_UTF8: "INVALID_UTF8",
} as const;

export type MarkdownErrorCode =
  (typeof MARKDOWN_ERROR_CODES)[keyof typeof MARKDOWN_ERROR_CODES];

export class MarkdownContentError extends Error {
  readonly code: MarkdownErrorCode;

  constructor(code: MarkdownErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "MarkdownContentError";
  }
}

export function isMarkdownFileName(fileName: string): boolean {
  return /\.(?:md|markdown)$/iu.test(fileName);
}

export function markdownContentByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

export function validateMarkdownByteLength(byteLength: number): number {
  if (byteLength > MARKDOWN_CONTENT_MAX_BYTES) {
    throw new MarkdownContentError(
      MARKDOWN_ERROR_CODES.CONTENT_TOO_LARGE,
      MARKDOWN_CONTENT_TOO_LARGE_MESSAGE
    );
  }
  return byteLength;
}

export function validateMarkdownContent(content: string): string {
  validateMarkdownByteLength(markdownContentByteLength(content));
  return content;
}

export function decodeMarkdownUtf8(bytes: Uint8Array): string {
  let content: string;
  try {
    content = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    throw new MarkdownContentError(
      MARKDOWN_ERROR_CODES.INVALID_UTF8,
      MARKDOWN_INVALID_UTF8_MESSAGE
    );
  }
  return validateMarkdownContent(content);
}
