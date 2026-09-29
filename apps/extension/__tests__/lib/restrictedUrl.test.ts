import { describe, expect, test } from "bun:test";
import { isRestrictedUrl } from "../../lib/restrictedUrl";

describe("lib/restrictedUrl", () => {
  test.each([
    undefined,
    "",
    "chrome://extensions",
    "chrome-extension://abcdef/popup.html",
    "moz-extension://abcdef/page.html",
    "edge-extension://abcdef/page.html",
    "about:blank",
    "data:text/html,<p>hi</p>",
    "file:///Users/me/notes.txt",
    "view-source:https://example.com",
    "filesystem:https://example.com/temporary/file",
  ])("blocks saving from %p", (url) => {
    expect(isRestrictedUrl(url)).toBe(true);
  });

  test.each(["https://example.com", "http://localhost:3000/cards"])(
    "allows saving from %p",
    (url) => {
      expect(isRestrictedUrl(url)).toBe(false);
    }
  );
});
