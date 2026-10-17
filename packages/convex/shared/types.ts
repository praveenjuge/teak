import type { Infer } from "convex/values";

export type { WithoutSystemFields } from "convex/server";
export type { Doc, Id } from "../_generated/dataModel";
export type {
  ActionCtx,
  DatabaseReader,
  DatabaseWriter,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";

import type {
  cardValidator,
  fileMetadataValidator,
  metadataValidator,
} from "../schema";

export type CardData = Infer<typeof cardValidator>;

export type CardMetadata = Infer<typeof metadataValidator>;

export type FileMetadata = Infer<typeof fileMetadataValidator>;

export interface UploadFileSuccessResult {
  cardId: string;
  success: true;
}

export interface UploadFileErrorResult {
  error: string;
  errorCode?: CardErrorCode | (string & {});
  success: false;
}

export type UploadFileResult = UploadFileSuccessResult | UploadFileErrorResult;

export type UploadMultipleFilesResultItem = UploadFileResult & { file: string };

import type { CardErrorCode } from "./constants";
