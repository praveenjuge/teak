import { describe, expect, test } from "bun:test";
import {
  decodeMarkdownUtf8,
  isMarkdownFileName,
  MARKDOWN_CONTENT_MAX_BYTES,
  markdownContentByteLength,
  validateMarkdownContent,
} from "../../shared/markdown";

describe("Markdown text-card contract", () => {
  test("matches Markdown filenames by final extension only", () => {
    for (const fileName of [
      "note.md",
      "NOTE.MD",
      "archive.MarkDown",
      ".markdown",
    ]) {
      expect(isMarkdownFileName(fileName)).toBe(true);
    }
    for (const fileName of [
      "note.mdx",
      "note.md.txt",
      "markdown",
      "note-md",
      "note.txt",
    ]) {
      expect(isMarkdownFileName(fileName)).toBe(false);
    }
  });

  test("preserves every submitted source character", () => {
    const source = [
      "\uFEFF  # Heading\r\n",
      "- [ ] task\r",
      "| A | B |\n| - | - |\n| 1 | 2 |\n",
      "---\ntitle: Frontmatter\n---\n",
      "```ts\r\nconst value = '✓';\r\n```\r\n",
      "[link](https://example.com) ![image](image.png)\n",
      "<span>HTML-like text</span>  ",
    ].join("");
    expect(validateMarkdownContent(source)).toBe(source);
    expect(decodeMarkdownUtf8(new TextEncoder().encode(source))).toBe(source);
  });

  test("enforces the exact UTF-8 byte boundary for multibyte content", () => {
    const exact = `${"a".repeat(MARKDOWN_CONTENT_MAX_BYTES - 4)}😀`;
    expect(markdownContentByteLength(exact)).toBe(MARKDOWN_CONTENT_MAX_BYTES);
    expect(validateMarkdownContent(exact)).toBe(exact);
    expect(() => validateMarkdownContent(`${exact}a`)).toThrow(
      "512 KiB when encoded as UTF-8"
    );
  });

  test("strictly rejects invalid UTF-8 without replacement decoding", () => {
    expect(() => decodeMarkdownUtf8(new Uint8Array([0xc3, 0x28]))).toThrow(
      "valid UTF-8"
    );
  });
});
