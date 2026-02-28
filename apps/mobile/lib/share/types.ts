import type { UploadFileResult } from "@teak/convex/shared/types";
import type { ResolvedSharePayload, SharePayload } from "expo-sharing";

export type IncomingShareStatus =
  | "resolving"
  | "saving"
  | "saved"
  | "partial"
  | "error"
  | "authRequired"
  | "empty";

export type NormalizedShareSource = "resolved" | "raw";

export type NormalizedShareItem =
  | {
      id: string;
      source: NormalizedShareSource;
      kind: "text";
      content: string;
    }
  | {
      id: string;
      source: NormalizedShareSource;
      kind: "file";
      content: string;
      fileUri: string;
      fileName: string;
      fileSize: number | null;
      mimeType: string;
    };

export type ShareNormalizationDropReason = "EMPTY_VALUE" | "UNSUPPORTED_TYPE";

export interface DroppedSharePayload {
  message: string;
  reason: ShareNormalizationDropReason;
}

export interface NormalizeIncomingShareInput {
  resolvedSharedPayloads: ResolvedSharePayload[];
  sharedPayloads: SharePayload[];
}

export interface NormalizeIncomingShareResult {
  dropped: DroppedSharePayload[];
  items: NormalizedShareItem[];
  source: NormalizedShareSource | "none";
}

export type ShareImportFailureReason =
  | "UNAUTHENTICATED"
  | "TOO_MANY_ITEMS"
  | "FILE_TOO_LARGE"
  | "UPLOAD_FAILED"
  | "CREATE_FAILED";

export interface ShareImportFailure {
  itemId: string;
  message: string;
  reason: ShareImportFailureReason;
}

export interface ShareImportResult {
  attemptedItems: number;
  createdCardIds: string[];
  failedItems: number;
  failures: ShareImportFailure[];
  successfulItems: number;
  totalItems: number;
}

export type ShareUploadResult = UploadFileResult;
