import { describe, expect, test } from "bun:test";
import { splitTextByBytes, transcriptPreview } from "../../card/textContents";

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

describe("splitTextByBytes", () => {
  test("keeps text that fits in one part", () => {
    expect(splitTextByBytes("A short transcript.", 64)).toEqual([
      "A short transcript.",
    ]);
    expect(splitTextByBytes("", 64)).toEqual([]);
  });

  test("cuts long text into parts within the limit that join back exactly", () => {
    const text = "Waves rolled over the reef. ".repeat(40);
    const parts = splitTextByBytes(text, 100);
    expect(parts.slice(0, -1).every((part) => bytes(part) === 100)).toBe(true);
    expect(bytes(parts.at(-1) ?? "")).toBeLessThanOrEqual(100);
    expect(parts.join("")).toBe(text);
  });

  test("never splits a character across parts", () => {
    const text = "😀富士山é".repeat(50);
    const parts = splitTextByBytes(text, 10);
    expect(parts.every((part) => bytes(part) <= 10)).toBe(true);
    expect(parts.some((part) => /^[\uDC00-\uDFFF]/.test(part))).toBe(false);
    expect(parts.join("")).toBe(text);
  });
});

test("a transcript's preview is its trimmed start", () => {
  expect(transcriptPreview(`  Hello there. ${"x".repeat(400)}`)).toBe(
    `Hello there. ${"x".repeat(267)}`
  );
});
