import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import {
  convexFailureKind,
  isInvalidCursorError,
  isOptimisticConcurrencyError,
  isRateLimitContentionError,
} from "../convexFailures";

const WRITE_CONFLICT =
  'Documents read from or written to the "cards" table changed while this mutation was being run and on every subsequent retry. Another call to this mutation changed the document with ID "k57"';
const RATE_LIMIT_CONFLICT =
  'Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry.';

describe("convexFailureKind", () => {
  test.each([
    ["a write conflict", new Error(WRITE_CONFLICT), "writeConflict"],
    [
      "a write conflict on the rate limiter",
      new Error(RATE_LIMIT_CONFLICT),
      "rateLimitContention",
    ],
    [
      "a conflict thrown as a plain object",
      { message: WRITE_CONFLICT },
      "writeConflict",
    ],
    ["a conflict thrown as text", RATE_LIMIT_CONFLICT, "rateLimitContention"],
    [
      "Convex's InvalidCursor",
      new Error("InvalidCursor: Failed to parse cursor"),
      "invalidCursor",
    ],
    [
      "a pagination error Convex names",
      new ConvexError({
        isConvexSystemError: true,
        paginationError: "InvalidCursor",
      }),
      "invalidCursor",
    ],
    [
      "a cursor that isn't JSON",
      new SyntaxError("Unexpected token"),
      "invalidCursor",
    ],
    ["anything else", new Error("Too many documents read"), null],
    ["an app error", new ConvexError({ code: "NOT_FOUND" }), null],
    ["nothing", undefined, null],
  ])("%s", (_name, error, kind) => {
    expect(convexFailureKind(error)).toBe(kind as never);
  });

  test("the helpers agree with the kind", () => {
    expect(isOptimisticConcurrencyError(new Error(WRITE_CONFLICT))).toBe(true);
    expect(isOptimisticConcurrencyError(new Error(RATE_LIMIT_CONFLICT))).toBe(
      true
    );
    expect(isRateLimitContentionError(new Error(WRITE_CONFLICT))).toBe(false);
    expect(isRateLimitContentionError(new Error(RATE_LIMIT_CONFLICT))).toBe(
      true
    );
    expect(isInvalidCursorError(new Error(WRITE_CONFLICT))).toBe(false);
  });
});
