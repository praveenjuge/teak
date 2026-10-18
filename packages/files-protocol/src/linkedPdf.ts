export interface FilesLinkedPdfParams {
  destinationKey: string;
  url: string;
}

/** Why the PDF was not stored; nothing was written to R2. */
export type FilesLinkedPdfSkipReason =
  | "fetch_failed"
  | "http_error"
  | "too_large"
  | "unsupported_type";

export type FilesLinkedPdfResult =
  | {
      contentType: string;
      reused: boolean;
      size: number;
      stored: true;
    }
  | { reason: FilesLinkedPdfSkipReason; status?: number; stored: false };
