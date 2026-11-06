import { ConvexError } from "convex/values";

/**
 * What kind of Convex failure an error is. Convex throws these as plain
 * errors without a type or code to check, so they are told apart by the
 * text it writes; each message is tested in `convexFailures.test.ts`.
 *
 * - `writeConflict`: a mutation kept conflicting with another write after
 *   Convex's own retries; the same request can succeed in a moment.
 * - `rateLimitContention`: such a conflict on the rate limiter's table.
 * - `invalidCursor`: a pagination cursor Convex can't read.
 */
export type ConvexFailureKind =
  | "invalidCursor"
  | "rateLimitContention"
  | "writeConflict";

const WRITE_CONFLICT_TEXT =
  "changed while this mutation was being run and on every subsequent retry";
const RATE_LIMIT_TABLE_TEXT = '"rateLimits" table';
// Convex names a cursor it can't read either way, depending on where it
// failed: "InvalidCursor" from pagination, "Failed to parse cursor" when the
// cursor string itself is malformed.
const INVALID_CURSOR_TEXTS = ["InvalidCursor", "Failed to parse cursor"];

const messageOf = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
};

const isPaginationCursorError = (error: unknown): boolean => {
  if (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data?.paginationError === "InvalidCursor"
  ) {
    return true;
  }
  // A cursor that isn't JSON fails to parse before Convex can name it.
  if (error instanceof SyntaxError) {
    return true;
  }
  const message = messageOf(error);
  return Boolean(
    message && INVALID_CURSOR_TEXTS.some((text) => message.includes(text))
  );
};

export const convexFailureKind = (error: unknown): ConvexFailureKind | null => {
  if (isPaginationCursorError(error)) {
    return "invalidCursor";
  }
  const message = messageOf(error);
  if (!message?.includes(WRITE_CONFLICT_TEXT)) {
    return null;
  }
  return message.includes(RATE_LIMIT_TABLE_TEXT)
    ? "rateLimitContention"
    : "writeConflict";
};

/** Any write conflict, the rate limiter's included. */
export const isOptimisticConcurrencyError = (error: unknown): boolean => {
  const kind = convexFailureKind(error);
  return kind === "writeConflict" || kind === "rateLimitContention";
};

export const isRateLimitContentionError = (error: unknown): boolean =>
  convexFailureKind(error) === "rateLimitContention";

export const isInvalidCursorError = (error: unknown): boolean =>
  convexFailureKind(error) === "invalidCursor";
