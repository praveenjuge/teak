import { describe, expect, test } from "bun:test";
import {
  importStoredContentType,
  normalizeIndexItem,
} from "../../import/indexItems";

describe("importStoredContentType", () => {
  test("stores browser-active archive files as inert text", () => {
    expect(
      importStoredContentType({
        fileName: "page.html",
        mimeType: "text/html",
      })
    ).toBe("text/plain; charset=utf-8");
    expect(
      importStoredContentType({
        fileName: "image.svg",
        mimeType: "image/svg+xml",
      })
    ).toBe("text/plain; charset=utf-8");
  });

  test("canonicalizes passive archive file content types", () => {
    expect(
      importStoredContentType({
        fileName: "document.pdf",
        mimeType: "application/pdf",
      })
    ).toBe("application/pdf");
  });

  test("stores unknown or mismatched formats as opaque bytes", () => {
    expect(
      importStoredContentType({
        fileName: "document.pdf",
        mimeType: "text/html",
      })
    ).toBe("application/octet-stream");
  });
});

describe("normalizeIndexItem", () => {
  test("skips a link the file already listed under another address", () => {
    const seen = new Set<string>();
    const statuses = [
      "https://www.example.com/post/",
      "http://example.com/post?utm_medium=x",
      "https://example.com/post?id=2",
    ].map(
      (url, index) =>
        normalizeIndexItem(
          { type: "link", content: url, url },
          index,
          new Map(),
          seen
        ).status
    );
    expect(statuses).toEqual(["pending", "skipped", "pending"]);
  });
});
