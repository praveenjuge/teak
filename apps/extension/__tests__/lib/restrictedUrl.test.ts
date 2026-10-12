import { describe, expect, test } from "bun:test";
import { isRestrictedUrl, restrictedUrlMessage } from "../../lib/restrictedUrl";

describe("lib/restrictedUrl", () => {
  test.each([
    undefined,
    "",
    "chrome://extensions",
    "chrome-extension://abcdef/popup.html",
    "chrome-search://local-ntp/local-ntp.html",
    "chrome-untrusted://new-tab-page/",
    "devtools://devtools/bundled/inspector.html",
    "edge://settings",
    "brave://rewards",
    "opera://settings",
    "vivaldi://settings",
    "moz-extension://abcdef/page.html",
    "edge-extension://abcdef/page.html",
    "about:blank",
    "data:text/html,<p>hi</p>",
    "file:///Users/me/notes.txt",
    "view-source:https://example.com",
    "filesystem:https://example.com/temporary/file",
    "https://chromewebstore.google.com/detail/teak/abc",
    "https://chrome.google.com/webstore/detail/teak/abc",
    "https://microsoftedge.microsoft.com/addons/detail/teak/abc",
    "https://addons.mozilla.org/en-US/firefox/addon/teak/",
  ])("blocks saving from %p", (url) => {
    expect(isRestrictedUrl(url)).toBe(true);
  });

  test.each([
    "https://example.com",
    "http://localhost:3000/cards",
    "https://chrome.google.com/intl/en/chrome/",
    "https://microsoftedge.microsoft.com/",
    "https://example.com/?next=chrome://settings",
  ])("allows saving from %p", (url) => {
    expect(isRestrictedUrl(url)).toBe(false);
  });

  test("explains a missing tab URL instead of throwing", () => {
    expect(restrictedUrlMessage(undefined)).toBe(
      "Cannot save content from this page. Try using the extension on regular web pages."
    );
  });

  test("names the page's scheme", () => {
    expect(restrictedUrlMessage("edge://settings")).toContain(
      "Cannot save content from edge: pages."
    );
  });

  test("explains add-on store pages without blaming https", () => {
    const message = restrictedUrlMessage(
      "https://chromewebstore.google.com/detail/teak/abc"
    );
    expect(message).toContain("add-on store pages");
    expect(message).not.toContain("https:");
  });
});
