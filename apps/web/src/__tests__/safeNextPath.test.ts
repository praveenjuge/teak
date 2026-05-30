import { describe, expect, test } from "bun:test";
import { getSafeNextPath } from "@/lib/safe-next-path";

describe("getSafeNextPath", () => {
  test("returns null for empty/missing values", () => {
    expect(getSafeNextPath(null)).toBeNull();
    expect(getSafeNextPath(undefined)).toBeNull();
    expect(getSafeNextPath("")).toBeNull();
  });

  test("accepts same-origin relative paths and preserves query/hash", () => {
    expect(getSafeNextPath("/settings")).toBe("/settings");
    expect(getSafeNextPath("/cards?tag=design")).toBe("/cards?tag=design");
    expect(getSafeNextPath("/cards#section")).toBe("/cards#section");
    expect(getSafeNextPath("/cards?tag=design#top")).toBe(
      "/cards?tag=design#top"
    );
  });

  test("rejects absolute and protocol-relative URLs", () => {
    expect(getSafeNextPath("https://evil.com")).toBeNull();
    expect(getSafeNextPath("http://evil.com/path")).toBeNull();
    expect(getSafeNextPath("//evil.com")).toBeNull();
    expect(getSafeNextPath("//evil.com/path")).toBeNull();
  });

  test("rejects backslash-normalized host escapes", () => {
    // Browsers/URL parsing can normalize backslashes into forward slashes,
    // turning these into a different host after login.
    expect(getSafeNextPath("/\\evil.com")).toBeNull();
    expect(getSafeNextPath("/\\/evil.com")).toBeNull();
    expect(getSafeNextPath("\\\\evil.com")).toBeNull();
    expect(getSafeNextPath("/path\\to")).toBeNull();
  });

  test("rejects control characters", () => {
    expect(getSafeNextPath("/path\nwith-newline")).toBeNull();
    expect(getSafeNextPath("/path\twith-tab")).toBeNull();
    expect(getSafeNextPath("/\u0000")).toBeNull();
  });

  test("rejects auth routes to avoid redirect loops", () => {
    expect(getSafeNextPath("/login")).toBeNull();
    expect(getSafeNextPath("/register")).toBeNull();
    expect(getSafeNextPath("/reset-password")).toBeNull();
    expect(getSafeNextPath("/forgot-password")).toBeNull();
    // With query string the path is still an auth route and must be rejected.
    expect(getSafeNextPath("/login?next=%2Fsettings")).toBeNull();
  });

  test("rejects values that do not start with a slash", () => {
    expect(getSafeNextPath("settings")).toBeNull();
    expect(getSafeNextPath("javascript:alert(1)")).toBeNull();
  });

  test("returned value stays same-origin when resolved against an origin", () => {
    const origin = "https://app.example.com";
    const safe = getSafeNextPath("/settings?a=1#b");
    expect(safe).not.toBeNull();
    if (safe) {
      expect(new URL(safe, origin).origin).toBe(origin);
    }
  });
});
