import { describe, expect, test } from "bun:test";
import { isRevokedKeyAnswer } from "../../.agents/skills/verify-teak/scripts/api-key.ts";

describe("verify-teak api-key: revoked answers", () => {
  test("401 INVALID_API_KEY means the key is revoked", () => {
    expect(
      isRevokedKeyAnswer(401, {
        code: "INVALID_API_KEY",
        error: "Invalid or revoked API key",
      })
    ).toBe(true);
  });

  test("another 401 leaves the key live, so revoke still calls the backend", () => {
    expect(isRevokedKeyAnswer(401, { code: "UNAUTHORIZED" })).toBe(false);
    expect(isRevokedKeyAnswer(401, null)).toBe(false);
  });

  test("a working key is not revoked", () => {
    expect(isRevokedKeyAnswer(200, { id: "user" })).toBe(false);
  });
});
