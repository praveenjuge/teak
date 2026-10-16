import { describe, expect, test } from "bun:test";
import {
  documentTextKey,
  isExtractedTextTruncated,
  searchPrefix,
} from "../../card/documentText";

describe("searchPrefix", () => {
  test("keeps text that fits and cuts longer text at a whole character", () => {
    expect(searchPrefix("short", 10)).toBe("short");
    expect(searchPrefix("abcdef", 4)).toBe("abcd");
    expect(searchPrefix("aéé", 4)).toBe("aé");
    expect(searchPrefix("😀😀", 6)).toBe("😀");
    expect(searchPrefix("中文字", 7)).toBe("中文");
  });
});

describe("isExtractedTextTruncated", () => {
  test("a full character budget or pages past the read limit", () => {
    expect(isExtractedTextTruncated("short text", 3)).toBe(false);
    expect(isExtractedTextTruncated("short text", 501)).toBe(true);
    expect(isExtractedTextTruncated("x".repeat(512 * 1024))).toBe(true);
    expect(isExtractedTextTruncated("é".repeat(256 * 1024))).toBe(true);
    expect(isExtractedTextTruncated("é".repeat(256 * 1024), 120)).toBe(false);
    expect(isExtractedTextTruncated("é".repeat(512 * 1024), 120)).toBe(true);
  });
});

describe("documentTextKey", () => {
  test("lives under the card in its owner's namespace, named by digest", () => {
    const key = documentTextKey(
      { _id: "abc123" as never, userId: "u1" },
      "f".repeat(64)
    );
    expect(key).toMatch(/\/abc123\/document-text\/f{64}\.txt$/);
    expect(() =>
      documentTextKey({ _id: "abc123" as never, userId: "u1" }, "nothex")
    ).toThrow("document_text_invalid_key");
  });
});
