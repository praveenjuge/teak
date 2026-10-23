import { describe, expect, test } from "bun:test";
import { urlKey } from "../../../shared/utils/urlKey";

describe("urlKey", () => {
  test.each([
    "https://www.example.com/post/",
    "https://www.example.com/post",
    "http://example.com/post",
    "https://example.com/post/",
    "https://EXAMPLE.com/post",
    "https://example.com./post",
    "https://example.com:443/post",
    "http://example.com:80/post",
    "https://example.com/post#top",
    "https://example.com/post?utm_source=x&utm_medium=y",
    "https://example.com/post?UTM_Campaign=x",
    "https://example.com/post?fbclid=abc",
    "https://example.com/post?gclid=abc&utm_source=x#section",
    "  https://example.com/post  ",
  ])("%s is the same link as https://www.example.com/post/", (url) => {
    expect(urlKey(url)).toBe("example.com/post");
  });

  test.each([
    ["https://example.com/?id=1&utm_source=x", "example.com/?id=1"],
    ["https://example.com/?utm_source=x&id=1", "example.com/?id=1"],
    ["https://example.com/a?b=2&a=1", "example.com/a?b=2&a=1"],
    ["https://example.com/a?ref=home", "example.com/a?ref=home"],
    ["https://example.com/app#/route", "example.com/app#/route"],
    ["https://example.com/app#!/route", "example.com/app#!/route"],
    ["https://example.com", "example.com/"],
    ["https://example.com/", "example.com/"],
    ["https://example.com:8080/x", "example.com:8080/x"],
    ["https://user:pass@example.com/x", "user:pass@example.com/x"],
    ["https://例え.jp/パス", "xn--r8jz45g.jp/%E3%83%91%E3%82%B9"],
    ["https://www/", "www/"],
  ])("%s → %s", (url, key) => {
    expect(urlKey(url)).toBe(key);
  });

  test.each([
    ["?id=1", "?id=2"],
    ["?b=2&a=1", "?a=1&b=2"],
    ["/Post", "/post"],
    ["#/one", "#/two"],
    ["/a/b", "/a"],
  ])("keeps %s and %s apart", (left, right) => {
    expect(urlKey(`https://example.com/x${left}`)).not.toBe(
      urlKey(`https://example.com/x${right}`)
    );
  });

  test("keeps two different credentials apart", () => {
    expect(urlKey("https://a:1@example.com/")).not.toBe(
      urlKey("https://b:2@example.com/")
    );
  });

  test("keeps a 2,000-character URL whole", () => {
    const url = `https://example.com/${"a".repeat(2000)}`;
    expect(urlKey(url)).toBe(`example.com/${"a".repeat(2000)}`);
  });

  test.each([
    "javascript:alert(1)",
    "data:text/html,hi",
    "mailto:someone@example.com",
    "ftp://example.com/file",
    "",
    "   ",
    "not a url",
    "http://",
    "https://[bad",
  ])("%p has no key", (url) => {
    expect(urlKey(url)).toBeUndefined();
  });

  test("never throws on random input", () => {
    const alphabet = "ht:/?#&=%.@[]wexample_utm+-!~ 日本";
    let seed = 7;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (let run = 0; run < 2000; run++) {
      const length = next() % 40;
      let input = run % 2 === 0 ? "https://" : "";
      for (let index = 0; index < length; index++) {
        input += alphabet[next() % alphabet.length];
      }
      expect(() => urlKey(input)).not.toThrow();
    }
  });
});
