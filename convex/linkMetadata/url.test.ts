
import { describe, expect, test } from "bun:test";
import { normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  test("returns url as is if it starts with https://", () => {
    const url = "https://example.com";
    expect(normalizeUrl(url)).toBe(url);
  });

  test("returns url as is if it starts with http://", () => {
    const url = "http://example.com";
    expect(normalizeUrl(url)).toBe(url);
  });

  test("prepends https:// if url does not start with http:// or https://", () => {
    const url = "example.com";
    expect(normalizeUrl(url)).toBe(`https://${url}`);
  });
});
