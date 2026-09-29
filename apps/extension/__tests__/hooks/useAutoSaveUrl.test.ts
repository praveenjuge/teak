import { describe, expect, test } from "bun:test";
import { isValidUrl } from "../../hooks/useAutoSaveUrl";

describe("useAutoSaveUrl isValidUrl", () => {
  test.each(["http://example.com", "https://example.com/path?q=1#hash"])(
    "auto-saves web page %s",
    (url) => {
      expect(isValidUrl(url)).toBe(true);
    }
  );

  test.each([
    "",
    "chrome://extensions",
    "chrome-extension://abcdef/popup.html",
    "about:blank",
    "data:text/html,<p>hi</p>",
    "javascript:alert(1)",
    "file:///Users/me/notes.txt",
    "moz-extension://abcdef/page.html",
    "edge-extension://abcdef/page.html",
    "ftp://example.com/file",
    "example.com",
  ])("refuses to auto-save %p", (url) => {
    expect(isValidUrl(url)).toBe(false);
  });
});
