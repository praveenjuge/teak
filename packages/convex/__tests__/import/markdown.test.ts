import { describe, expect, test } from "bun:test";
import { resolveLegacyMarkdownImport } from "../../import/markdown";

describe("legacy Markdown archive import", () => {
  test("converts case-insensitive Markdown documents and preserves bytes", () => {
    const content = "\uFEFF  ---\r\ntitle: Notes\r\n---\r\n\r\n# Heading  \n";
    expect(
      resolveLegacyMarkdownImport(
        { fileName: "Notes.MARKDOWN", type: "document" },
        new TextEncoder().encode(content)
      )
    ).toEqual({ content, type: "text" });
  });

  test("leaves MDX, MIME-only, and existing text entries unchanged", () => {
    const bytes = new TextEncoder().encode("# Note");
    expect(
      resolveLegacyMarkdownImport(
        { fileName: "component.mdx", type: "document" },
        bytes
      )
    ).toBeNull();
    expect(
      resolveLegacyMarkdownImport(
        { fileName: "note.txt", type: "document" },
        bytes
      )
    ).toBeNull();
    expect(
      resolveLegacyMarkdownImport({ fileName: "note.md", type: "text" }, bytes)
    ).toBeNull();
  });

  test("accepts exactly 512 KiB and rejects one byte over", () => {
    expect(
      resolveLegacyMarkdownImport(
        { fileName: "exact.md", type: "document" },
        new Uint8Array(512 * 1024).fill(97)
      )
    ).toMatchObject({ type: "text" });
    expect(
      resolveLegacyMarkdownImport(
        { fileName: "large.md", type: "document" },
        new Uint8Array(512 * 1024 + 1).fill(97)
      )
    ).toMatchObject({
      failureCode: "CONTENT_TOO_LARGE",
      status: "failed",
    });
  });

  test("rejects invalid UTF-8 without replacement decoding", () => {
    expect(
      resolveLegacyMarkdownImport(
        { fileName: "invalid.md", type: "document" },
        new Uint8Array([0xc3, 0x28])
      )
    ).toMatchObject({ failureCode: "INVALID_UTF8", status: "failed" });
  });
});
