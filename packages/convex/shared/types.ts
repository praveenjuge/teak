/**
 * Centralized TypeScript types for Convex functions and client-side code.
 *
 * This file follows Convex TypeScript best practices:
 * - Uses `Infer` to derive types from validators (single source of truth)
 * - Exports context types for helper function annotations
 * - Provides `WithoutSystemFields` for document creation helpers
 *
 * @see https://docs.convex.dev/understanding/best-practices/typescript
 */

import type { WithoutSystemFields } from "convex/server";
import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Re-export common types from convex/server for convenience
export type { WithoutSystemFields } from "convex/server";
// Re-export document and ID types
export type { Doc, Id } from "../_generated/dataModel";
// Re-export context types for helper function annotations
export type {
  ActionCtx,
  DatabaseReader,
  DatabaseWriter,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";

// Import validators from schema for type inference
import type {
  cardTypeValidator,
  cardValidator,
  colorValidator,
  fileMetadataValidator,
  linkCategoryMetadataValidator,
  linkCategoryValidator,
  metadataValidator,
  processingStatusObjectValidator,
} from "../schema";

// ============================================================================
// Inferred Types from Validators
// ============================================================================

/**
 * Card type union inferred from the cardTypeValidator.
 * Use this instead of manually maintaining the union type.
 */
export type CardTypeFromValidator = Infer<typeof cardTypeValidator>;

/**
 * Full card document shape (without system fields) inferred from validator.
 * Useful for creating new cards or specifying card data.
 */
export type CardData = Infer<typeof cardValidator>;

/**
 * Card document shape without system fields (_id, _creationTime).
 * Use when inserting new cards via ctx.db.insert().
 */
export type CardInsertData = WithoutSystemFields<Doc<"cards">>;

/**
 * Color object type for palette cards inferred from validator.
 * Note: Use `Color` from `colorUtils.ts` for the same shape with utility functions.
 */
export type ColorFromValidator = Infer<typeof colorValidator>;

/**
 * Link category type inferred from validator.
 * Note: Use `LinkCategory` from `linkCategories.ts` for the canonical type.
 */
export type LinkCategoryFromValidator = Infer<typeof linkCategoryValidator>;

/**
 * Link category metadata structure inferred from validator.
 * Note: Use `LinkCategoryMetadata` from `linkCategories.ts` for the interface with optional `raw` typed.
 */
export type LinkCategoryMetadataFromValidator = Infer<
  typeof linkCategoryMetadataValidator
>;

/**
 * Card metadata structure (for link previews, etc.).
 */
export type CardMetadata = Infer<typeof metadataValidator>;

/**
 * File metadata structure (for non-link cards with files).
 */
export type FileMetadata = Infer<typeof fileMetadataValidator>;

/**
 * Processing status structure for pipeline tracking.
 */
export type ProcessingStatusObject = Infer<
  typeof processingStatusObjectValidator
>;

// ============================================================================
// Helper Type Utilities
// ============================================================================

/**
 * Extract the return type of a Convex query/mutation handler.
 * Useful for typing helper functions that return the same data shape.
 *
 * @example
 * ```ts
 * type GetCardResult = HandlerReturnType<typeof getCard.handler>;
 * ```
 */
export type HandlerReturnType<T extends (...args: any) => any> = Awaited<
  ReturnType<T>
>;

/**
 * Partial card data for updates (all fields optional except those needed).
 */
export type CardUpdateData = Partial<Omit<CardData, "userId" | "createdAt">>;

// ============================================================================
// Function Parameter Types
// ============================================================================

/**
 * Common parameters for card-related helper functions.
 */
export interface CardHelperParams {
  cardId: Id<"cards">;
  userId: string;
}

/**
 * Parameters for authenticated mutation helpers.
 */
export interface AuthenticatedMutationParams {
  ctx: MutationCtx;
  userId: string;
}

/**
 * Parameters for authenticated query helpers.
 */
export interface AuthenticatedQueryParams {
  ctx: QueryCtx;
  userId: string;
}

// ============================================================================
// File Upload Result Types
// ============================================================================

/**
 * Result of a successful file upload.
 */
export type UploadFileSuccessResult = {
  success: true;
  cardId: string;
};

/**
 * Result of a failed file upload.
 */
export type UploadFileErrorResult = {
  success: false;
  error: string;
  errorCode?: CardErrorCode | (string & {});
};

/**
 * Union type for file upload results.
 */
export type UploadFileResult = UploadFileSuccessResult | UploadFileErrorResult;

/**
 * Result item for multiple file uploads, includes the original filename.
 */
export type UploadMultipleFilesResultItem = UploadFileResult & { file: string };

import type { CardErrorCode } from "./constants";
