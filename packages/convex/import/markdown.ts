import {
  decodeMarkdownUtf8,
  isMarkdownFileName,
  MarkdownContentError,
} from "../shared/markdown";

export type LegacyMarkdownImportResult =
  | { content: string; type: "text" }
  | {
      failureCode: "CONTENT_TOO_LARGE" | "INVALID_UTF8";
      failureReason: string;
      status: "failed";
    }
  | null;

export function resolveLegacyMarkdownImport(
  item: { fileName?: string; type: string },
  bytes: Uint8Array
): LegacyMarkdownImportResult {
  if (
    item.type !== "document" ||
    !item.fileName ||
    !isMarkdownFileName(item.fileName)
  ) {
    return null;
  }
  try {
    return { content: decodeMarkdownUtf8(bytes), type: "text" };
  } catch (error) {
    if (error instanceof MarkdownContentError) {
      return {
        failureCode: error.code,
        failureReason: error.message,
        status: "failed",
      };
    }
    throw error;
  }
}
