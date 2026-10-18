/**
 * `store-linked-pdf`: an arXiv paper's PDF downloaded straight into R2 for
 * Save PDF. Only `https://arxiv.org/pdf/<id>` is fetched.
 */
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
      /** The PDF was already stored by an earlier, interrupted try. */
      reused: boolean;
      size: number;
      stored: true;
    }
  | { reason: FilesLinkedPdfSkipReason; status?: number; stored: false };
