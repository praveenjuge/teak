import { describe, expect, test } from "bun:test";
import { isBlockingFinding, parseScopeArg } from "./check-cloudflare.ts";

describe("parseScopeArg", () => {
  test("null without the flag", () => {
    expect(parseScopeArg([])).toBeNull();
  });

  test("parses prod and dev scopes", () => {
    expect(parseScopeArg(["--only", "prod"])).toBe("prod");
    expect(parseScopeArg(["--only", "dev"])).toBe("dev");
  });

  test("rejects unknown scopes", () => {
    expect(() => parseScopeArg(["--only", "staging"])).toThrow();
    expect(() => parseScopeArg(["--only"])).toThrow();
  });
});

describe("isBlockingFinding", () => {
  test("missing and different block by default", () => {
    expect(isBlockingFinding("missing")).toBe(true);
    expect(isBlockingFinding("different")).toBe(true);
  });

  test("ok, same, and warn never block by default", () => {
    expect(isBlockingFinding("ok")).toBe(false);
    expect(isBlockingFinding("same")).toBe(false);
    expect(isBlockingFinding("warn")).toBe(false);
  });

  test("explicit override wins either way", () => {
    expect(isBlockingFinding("missing", { blocking: false })).toBe(false);
    expect(isBlockingFinding("warn", { blocking: true })).toBe(true);
  });
});
