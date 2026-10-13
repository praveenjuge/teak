import { describe, expect, test } from "bun:test";
import {
  hostForDisplay,
  normalizeUrlHost,
} from "../../../shared/utils/urlHost";

describe("normalizeUrlHost", () => {
  test.each([
    ["https://www.GitHub.com/teak", "github.com"],
    ["github.com", "github.com"],
    ["github.com/teak?tab=1", "github.com"],
    ["WWW.example.com:8080/x?y", "example.com"],
    ["http://example.com./path", "example.com"],
    ["https://blog.example.com", "blog.example.com"],
    ["https://例え.jp/パス", "xn--r8jz45g.jp"],
    ["münchen.de", "xn--mnchen-3ya.de"],
    ["http://192.168.0.1:3000/", "192.168.0.1"],
    ["http://[::1]/", "[::1]"],
    ["localhost:8080", "localhost"],
    ["www", "www"],
  ])("%s → %s", (input: string, expected: string) => {
    expect(normalizeUrlHost(input)).toBe(expected);
  });

  test.each([
    [undefined],
    [""],
    ["   "],
    ["mailto:someone@example.com"],
    ["tel:+15551234"],
    ["javascript:alert(1)"],
    ["http://"],
  ])("%p has no site", (input: string | undefined) => {
    expect(normalizeUrlHost(input)).toBeNull();
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
  test("shows punycode labels as Unicode", () => {
    expect(hostForDisplay("xn--r8jz45g.jp")).toBe("例え.jp");
    expect(hostForDisplay("xn--mnchen-3ya.de")).toBe("münchen.de");
  });

  test("leaves ASCII and invalid punycode alone", () => {
    expect(hostForDisplay("github.com")).toBe("github.com");
    expect(hostForDisplay("xn--!!.com")).toBe("xn--!!.com");
  });
});
