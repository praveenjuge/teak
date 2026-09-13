import { describe, expect, it } from "bun:test";
import {
  assertSafeExternalUrl,
  getSafeUrlHostname,
  isSafeExternalUrl,
  sanitizeExternalUrl,
  UnsafeUrlError,
} from "./safeUrl";

describe("isSafeExternalUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isSafeExternalUrl("http://example.com")).toBe(true);
    expect(isSafeExternalUrl("https://example.com/path?q=1#frag")).toBe(true);
    expect(isSafeExternalUrl("https://user:pass@example.com")).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isSafeExternalUrl("  https://example.com  ")).toBe(true);
  });

  it("rejects dangerous schemes", () => {
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(
      false
    );
    expect(isSafeExternalUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalUrl("mailto:test@example.com")).toBe(false);
  });

  it("rejects relative and scheme-less URLs", () => {
    expect(isSafeExternalUrl("example.com")).toBe(false);
    expect(isSafeExternalUrl("//example.com")).toBe(false);
    expect(isSafeExternalUrl("/path/only")).toBe(false);
  });

  it("rejects empty and non-string values", () => {
    expect(isSafeExternalUrl("")).toBe(false);
    expect(isSafeExternalUrl("   ")).toBe(false);
    expect(isSafeExternalUrl(undefined)).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl(123)).toBe(false);
  });
});

describe("sanitizeExternalUrl", () => {
  it("returns the trimmed URL when safe", () => {
    expect(sanitizeExternalUrl("  https://example.com  ")).toBe(
      "https://example.com"
    );
  });

  it("returns undefined for unsafe or empty values", () => {
    expect(sanitizeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeExternalUrl("")).toBeUndefined();
    expect(sanitizeExternalUrl(null)).toBeUndefined();
    expect(sanitizeExternalUrl(undefined)).toBeUndefined();
  });
});

describe("assertSafeExternalUrl", () => {
  it("returns the trimmed URL when safe", () => {
    expect(assertSafeExternalUrl("  https://example.com/x  ")).toBe(
      "https://example.com/x"
    );
  });

  it("returns undefined for nullish or empty values", () => {
    expect(assertSafeExternalUrl(null)).toBeUndefined();
    expect(assertSafeExternalUrl(undefined)).toBeUndefined();
    expect(assertSafeExternalUrl("")).toBeUndefined();
    expect(assertSafeExternalUrl("   ")).toBeUndefined();
  });

  it("throws UnsafeUrlError for unsafe schemes", () => {
    expect(() => assertSafeExternalUrl("javascript:alert(1)")).toThrow(
      UnsafeUrlError
    );
    expect(() => assertSafeExternalUrl("data:text/html,x")).toThrow(
      UnsafeUrlError
    );
    expect(() => assertSafeExternalUrl("example.com")).toThrow(UnsafeUrlError);
  });
});

describe("getSafeUrlHostname", () => {
  it("returns only the hostname for safe URLs, never the path or query", () => {
    expect(
      getSafeUrlHostname("https://example.com/secret/path?token=abc#frag")
    ).toBe("example.com");
    expect(getSafeUrlHostname("  http://sub.example.com:8080/x  ")).toBe(
      "sub.example.com"
    );
  });

  it("returns undefined for unsafe schemes and non-http(s) values", () => {
    expect(getSafeUrlHostname("javascript:alert(1)")).toBeUndefined();
    expect(getSafeUrlHostname("file:///etc/passwd")).toBeUndefined();
    expect(getSafeUrlHostname("mailto:test@example.com")).toBeUndefined();
  });

  it("returns undefined for relative, empty, and non-string values", () => {
    expect(getSafeUrlHostname("example.com")).toBeUndefined();
    expect(getSafeUrlHostname("/path/only")).toBeUndefined();
    expect(getSafeUrlHostname("")).toBeUndefined();
    expect(getSafeUrlHostname(null)).toBeUndefined();
    expect(getSafeUrlHostname(undefined)).toBeUndefined();
  });
});
