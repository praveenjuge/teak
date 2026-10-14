import { describe, expect, test } from "bun:test";
import { isAutoInternalAccount, requireReason } from "../adminAccess";

describe("isAutoInternalAccount", () => {
  test.each([
    [{ email: "founder@teak.dev", role: "admin" as const }, true],
    [{ email: "e2e-run-42@teakvault.com" }, true],
    [{ email: "dev+machine-1@example.org" }, true],
    [{ email: "someone@mail.test" }, true],
    [{ email: "reader@gmail.com" }, false],
    [{ email: "ceo@examples.com" }, false],
  ] as [{ email: string; role?: "admin" }, boolean][])(
    "%j is internal: %p",
    (user: { email: string; role?: "admin" }, expected: boolean) => {
      expect(isAutoInternalAccount(user)).toBe(expected);
    }
  );
});

describe("requireReason", () => {
  test("refuses an empty or token reason", () => {
    expect(() => requireReason(undefined)).toThrow("A reason is required");
    expect(() => requireReason("  ok ")).toThrow("A reason is required");
  });

  test("keeps a trimmed reason, capped in length", () => {
    expect(requireReason("  support ticket 12  ")).toBe("support ticket 12");
    expect(requireReason("x".repeat(900))).toHaveLength(500);
  });
});
