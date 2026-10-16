import type { WithoutSystemFields } from "convex/server";
import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

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
  cardTypeValidator,
  cardValidator,
  fileMetadataValidator,
  metadataValidator,
  processingStatusObjectValidator,
} from "../schema";

export type CardTypeFromValidator = Infer<typeof cardTypeValidator>;

export type CardData = Infer<typeof cardValidator>;

export type CardInsertData = WithoutSystemFields<Doc<"cards">>;

export type CardMetadata = Infer<typeof metadataValidator>;

export type FileMetadata = Infer<typeof fileMetadataValidator>;

export type ProcessingStatusObject = Infer<
  typeof processingStatusObjectValidator
>;

export type HandlerReturnType<T extends (...args: any) => any> = Awaited<
  ReturnType<T>
>;

export type CardUpdateData = Partial<Omit<CardData, "userId" | "createdAt">>;

export interface CardHelperParams {
  cardId: Id<"cards">;
  userId: string;
}

export interface AuthenticatedMutationParams {
  ctx: MutationCtx;
  userId: string;
}

export interface AuthenticatedQueryParams {
  ctx: QueryCtx;
  userId: string;
}

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
