// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { normalizeUrl } from "../../../convex/linkMetadata/url";

describe("normalizeUrl", () => {
  test("adds https when missing", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
  });

  test("keeps http urls", () => {
    expect(normalizeUrl("http://example.com")).toBe("http://example.com");
  });

  test("keeps https urls", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  });
});
