import { describe, expect, test } from "bun:test";
import {
  buildCardsSearchParams,
  getRecoveryHint,
  getUserFacingErrorMessage,
  RaycastApiError,
  toErrorCode,
} from "../lib/apiErrors";

describe("raycast api helpers", () => {
  test("buildCardsSearchParams trims and encodes query params", () => {
    expect(
      buildCardsSearchParams({
        favorited: true,
        limit: 50,
        query: "  design systems  ",
        sort: "oldest",
        tag: "research",
        type: "link",
      }),
    ).toBe(
      "q=design+systems&type=link&tag=research&favorited=true&sort=oldest&limit=50",
    );
  });

  test("buildCardsSearchParams omits empty query", () => {
    expect(buildCardsSearchParams({ query: "   ", limit: 50 })).toBe(
      "limit=50",
    );
  });

  test("buildCardsSearchParams includes full-card fields on request", () => {
    expect(
      buildCardsSearchParams({ include: "content,metadata", limit: 10 }),
    ).toBe("include=content%2Cmetadata&limit=10");
  });

  test.each([
    [0, "limit=1"],
    [101, "limit=100"],
    [Number.NaN, "limit=50"],
    [undefined, "limit=50"],
  ])("buildCardsSearchParams clamps limit %p to %s", (limit, params) => {
    expect(buildCardsSearchParams({ limit })).toBe(params);
  });

  test("buildCardsSearchParams keeps Trash and color filters", () => {
    expect(
      buildCardsSearchParams({
        hex: ["#112233"],
        hue: ["blue", "teal"],
        limit: 20,
        style: ["minimal"],
        trashed: true,
      }),
    ).toBe(
      "limit=20&trashed=true&style=minimal&hue=blue&hue=teal&hex=%23112233",
    );
  });

  test("toErrorCode falls back for unknown values", () => {
    expect(toErrorCode("INVALID_API_KEY", "REQUEST_FAILED")).toBe(
      "INVALID_API_KEY",
    );
    expect(toErrorCode("NOT_FOUND", "REQUEST_FAILED")).toBe("NOT_FOUND");
    expect(toErrorCode("SOMETHING_ELSE", "REQUEST_FAILED")).toBe(
      "REQUEST_FAILED",
    );
  });

  test("maps invalid key errors to a user-facing message", () => {
    const error = new RaycastApiError("INVALID_API_KEY", 401);
    expect(getUserFacingErrorMessage(error)).toContain("invalid or revoked");
    expect(getRecoveryHint(error)).toContain("Open extension preferences");
  });

  test("maps rate limit errors to retry guidance", () => {
    const error = new RaycastApiError("RATE_LIMITED", 429);
    expect(getUserFacingErrorMessage(error)).toContain("Too many requests");
    expect(getRecoveryHint(error)).toContain("Wait a few seconds");
  });

  test("maps network errors to connectivity guidance", () => {
    const error = new RaycastApiError("NETWORK_ERROR");
    expect(getUserFacingErrorMessage(error)).toContain("Unable to reach Teak");
    expect(getRecoveryHint(error)).toContain("Check network connectivity");
  });

  test("maps API config errors to local setup guidance", () => {
    const error = new RaycastApiError("CONFIG_ERROR", 500);

    expect(getUserFacingErrorMessage(error)).toContain(
      "missing required configuration",
    );
    expect(getRecoveryHint(error)).toContain("dev convex");
  });

  test("maps missing local API errors to dev guidance", () => {
    const error = new RaycastApiError("DEV_API_UNAVAILABLE", 404);

    expect(getUserFacingErrorMessage(error)).toContain("API");
    expect(getRecoveryHint(error)).toContain("bun run dev convex");
  });

  test("maps not found errors without implying a card was deleted", () => {
    const error = new RaycastApiError("NOT_FOUND", 404);

    expect(getUserFacingErrorMessage(error)).toContain("requested resource");
    expect(getUserFacingErrorMessage(error)).not.toContain(
      "card no longer exists",
    );
    expect(getRecoveryHint(error)).toContain("API URL");
  });

  test("handles unknown error values", () => {
    expect(getUserFacingErrorMessage(null)).toContain(
      "temporarily unavailable",
    );
  });
});
