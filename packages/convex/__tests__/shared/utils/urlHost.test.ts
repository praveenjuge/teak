import { describe, expect, test } from "bun:test";
import {
  hostForDisplay,
  normalizeUrlHost,
} from "../../../shared/utils/urlHost";
import { loadFixture } from "../loadFixture";

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
