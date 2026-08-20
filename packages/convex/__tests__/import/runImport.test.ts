import { describe, expect, test } from "bun:test";
import { importStoredContentType } from "../../import/runImport";

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
