// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { sanitizeUrl, sanitizeImageUrl } from "../convex/linkMetadata/parsing";

describe("sanitizeUrl", () => {
  test("resolves relative url against base", () => {
    expect(sanitizeUrl("https://example.com", "/path")).toBe("https://example.com/path");
  });

  test("rejects javascript/mailto schemes", () => {
    expect(sanitizeUrl("https://example.com", "javascript:alert(1)")).toBeUndefined();
    expect(sanitizeUrl("https://example.com", "mailto:test@example.com")).toBeUndefined();
  });

  test("handles data urls depending on allowData", () => {
    expect(sanitizeUrl("https://example.com", "data:image/png;base64,abc"))
      .toBeUndefined();
    expect(sanitizeUrl("https://example.com", "data:image/png;base64,abc", { allowData: true }))
      .toBe("data:image/png;base64,abc");
  });
});

describe("sanitizeImageUrl", () => {
  test("allows data urls", () => {
    expect(sanitizeImageUrl("https://example.com", "data:image/png;base64,abc"))
      .toBe("data:image/png;base64,abc");
  });
});
