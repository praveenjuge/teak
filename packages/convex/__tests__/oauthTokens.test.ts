// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import {
  isWellFormedOAuthToken,
  validateOAuthAccessToken,
} from "../oauthTokens";

const runHandler = (fn: any, ctx: any, args: any) =>
  (fn.handler ?? fn)(ctx, args);

describe("isWellFormedOAuthToken", () => {
  test("accepts 32-char alphanumeric tokens", () => {
    expect(isWellFormedOAuthToken("a".repeat(32))).toBe(true);
    expect(isWellFormedOAuthToken("AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf")).toBe(
      true
    );
    // Better Auth's random-string alphabet can include digits, so a 32-char
    // alphanumeric token must be accepted (not treated as malformed).
    expect(isWellFormedOAuthToken("a1".repeat(16))).toBe(true);
    expect(isWellFormedOAuthToken("0123456789abcdefABCDEF0123456789")).toBe(
      true
    );
  });

  test("rejects wrong length, non-alphanumerics, and API keys", () => {
    expect(isWellFormedOAuthToken("a".repeat(31))).toBe(false);
    expect(isWellFormedOAuthToken("a".repeat(33))).toBe(false);
    // Hyphen is outside the opaque alphanumeric shape.
    expect(isWellFormedOAuthToken(`a-${"b".repeat(30)}`)).toBe(false);
    expect(
      isWellFormedOAuthToken(`teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`)
    ).toBe(false);
  });
});

describe("validateOAuthAccessToken", () => {
  const token = "a".repeat(32);

  test("resolves a validated OAuth user for a live token", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce({
        _id: "oauthAccessToken_1",
        accessTokenExpiresAt: Date.now() + 60_000,
        clientId: "teak-raycast",
        userId: "user_1",
      })
      .mockResolvedValueOnce({ _id: "user_1" });

    const result = await runHandler(
      validateOAuthAccessToken,
      { runQuery },
      { token }
    );

    expect(result).toEqual({
      access: "full_access",
      keyId: "oauthAccessToken_1",
      rateLimitKey: "oauth:teak-raycast:user_1",
      source: "oauth",
      userId: "user_1",
    });
  });

  test("returns null when the token row is missing", async () => {
    const runQuery = mock().mockResolvedValueOnce(null);
    const result = await runHandler(
      validateOAuthAccessToken,
      { runQuery },
      { token }
    );
    expect(result).toBeNull();
  });

  test("returns null for an expired token", async () => {
    const runQuery = mock().mockResolvedValueOnce({
      _id: "t1",
      accessTokenExpiresAt: Date.now() - 1000,
      clientId: "teak-raycast",
      userId: "user_1",
    });
    const result = await runHandler(
      validateOAuthAccessToken,
      { runQuery },
      { token }
    );
    expect(result).toBeNull();
  });

  test("returns null when the user no longer exists", async () => {
    const runQuery = mock()
      .mockResolvedValueOnce({
        _id: "t1",
        accessTokenExpiresAt: Date.now() + 60_000,
        clientId: "teak-raycast",
        userId: "user_1",
      })
      .mockResolvedValueOnce(null);
    const result = await runHandler(
      validateOAuthAccessToken,
      { runQuery },
      { token }
    );
    expect(result).toBeNull();
  });

  test("rejects a malformed token without touching the database", async () => {
    const runQuery = mock();
    const result = await runHandler(
      validateOAuthAccessToken,
      { runQuery },
      { token: "short" }
    );
    expect(result).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });
});
