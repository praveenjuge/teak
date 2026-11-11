import { describe, expect, test } from "bun:test";
import {
  hostForDisplay,
  normalizeUrlHost,
  urlHostForDisplay,
} from "../../../shared/utils/urlHost";
import { loadFixture } from "../loadFixture.test-utils";

const { normalize, display } = loadFixture<{
  display: { display: string; host: string }[];
  normalize: { host: string | null; input: string }[];
}>("urlHost");

describe("normalizeUrlHost", () => {
  test.each(normalize)("$input → $host", ({ input, host }) => {
    expect(normalizeUrlHost(input)).toBe(host);
  });

  test("has no site for nothing", () => {
    expect(normalizeUrlHost(undefined)).toBeNull();
  });

  test("the same site matches however it is written", () => {
    const hosts = [
      "site.example.com",
      "https://WWW.site.example.com/",
      "SITE.EXAMPLE.COM.",
    ].map(normalizeUrlHost);
    expect(new Set(hosts)).toEqual(new Set(["site.example.com"]));
  });
});

describe("hostForDisplay", () => {
  test.each(display)("$host → $display", ({ host, display: shown }) => {
    expect(hostForDisplay(host)).toBe(shown);
  });
});

describe("urlHostForDisplay", () => {
  test.each([
    ["https://www.theverge.com/2024/a", "theverge.com"],
    ["https://Docs.Convex.dev/x?y=1", "docs.convex.dev"],
    ["https://www.xn--r8jz45g.jp/page", "例え.jp"],
  ])("%s → %s", (url, shown) => {
    expect(urlHostForDisplay(url)).toBe(shown);
  });

  test.each(["javascript:alert(1)", "ftp://example.com", undefined])(
    "names no site for %p",
    (url) => {
      expect(urlHostForDisplay(url)).toBeUndefined();
    }
  );
});
