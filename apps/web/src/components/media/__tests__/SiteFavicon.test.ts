import { describe, expect, test } from "bun:test";
import { getFaviconUrl } from "../SiteFavicon";

describe("getFaviconUrl", () => {
  test("sends only the hostname to the favicon service", () => {
    const url = getFaviconUrl("example.com");
    expect(url).toContain("domain=example.com");
    expect(getFaviconUrl(undefined)).toBeUndefined();
  });
});
