import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import {
  cardErrorCode,
  isCardLimitError,
  isRateLimitError,
} from "../cardErrors";

describe("card errors", () => {
  test("reads a Convex error's code and a client error's own code", () => {
    expect(cardErrorCode(new ConvexError({ code: "RATE_LIMITED" }))).toBe(
      "RATE_LIMITED"
    );
    expect(
      cardErrorCode(Object.assign(new Error("x"), { code: "FILE_TOO_LARGE" }))
    ).toBe("FILE_TOO_LARGE");
  });

  test("ignores codes that aren't card errors, and things that aren't errors", () => {
    expect(cardErrorCode(new ConvexError({ code: "NOT_FOUND" }))).toBeNull();
    expect(cardErrorCode("RATE_LIMITED")).toBeNull();
    expect(cardErrorCode(null)).toBeNull();
  });

  test("tells a card limit from a rate limit", () => {
    const limit = new ConvexError({ code: "CARD_LIMIT_REACHED" });
    const rate = new ConvexError({ code: "RATE_LIMITED" });
    expect([isCardLimitError(limit), isRateLimitError(limit)]).toEqual([
      true,
      false,
    ]);
    expect([isCardLimitError(rate), isRateLimitError(rate)]).toEqual([
      false,
      true,
    ]);
  });
});
