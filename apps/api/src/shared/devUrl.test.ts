import { describe, expect, test } from "bun:test";
import { DEFAULT_TEAK_DEV_API_URL, resolveTeakDevApiUrl } from "./devUrl.js";

describe("resolveTeakDevApiUrl", () => {
  test("falls back to the default dev URL when env is empty", () => {
    expect(resolveTeakDevApiUrl({})).toBe(DEFAULT_TEAK_DEV_API_URL);
  });

  test("uses the env override when provided", () => {
    expect(
      resolveTeakDevApiUrl({ TEAK_DEV_API_URL: "https://dev.example.com" })
    ).toBe("https://dev.example.com");
  });

  test("strips trailing slashes, path, search, and hash", () => {
    expect(
      resolveTeakDevApiUrl({
        TEAK_DEV_API_URL: "https://dev.example.com/api/?a=1#x",
      })
    ).toBe("https://dev.example.com");
  });

  test("trims whitespace before parsing", () => {
    expect(
      resolveTeakDevApiUrl({ TEAK_DEV_API_URL: "  https://dev.example.com  " })
    ).toBe("https://dev.example.com");
  });

  test("throws on invalid URL input", () => {
    expect(() =>
      resolveTeakDevApiUrl({ TEAK_DEV_API_URL: "not a url" })
    ).toThrow(/Invalid TEAK_DEV_API_URL/);
  });

  test("ignores non-string env values", () => {
    expect(
      resolveTeakDevApiUrl({
        TEAK_DEV_API_URL: 123 as unknown as string,
      })
    ).toBe(DEFAULT_TEAK_DEV_API_URL);
  });
});
