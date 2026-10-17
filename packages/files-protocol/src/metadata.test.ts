import { describe, expect, test } from "bun:test";
import { MAX_IMAGE_OCR_CHARS, normalizeImageOcrText } from "./metadata";

describe("text read from an image", () => {
  test.each([
    [
      "keeps line breaks and indentation",
      "def f():\n    return 1",
      "def f():\n    return 1",
    ],
    ["collapses spaces inside a line", "Total   due:\t\t42", "Total due: 42"],
    [
      "collapses runs of blank lines",
      "Line one\n\n\n\nLine two",
      "Line one\n\nLine two",
    ],
    [
      "trims each line's end and the whole",
      "  Invoice 4411   \r\n  Paid  ",
      "Invoice 4411\n  Paid",
    ],
    ["drops control characters", "Exit\u0007 now", "Exit now"],
    [
      "keeps right-to-left marks and joiners",
      "\u200Fשלום\u200F",
      "\u200Fשלום\u200F",
    ],
    ["keeps non-Latin scripts", "東京駅 出口", "東京駅 出口"],
  ])("%s", (_name, input, expected) => {
    expect(normalizeImageOcrText(input)).toBe(expected);
  });

  test.each([
    ["empty", ""],
    ["whitespace", " \n\t "],
    ["punctuation only", "— … ·"],
    ["two characters", "OK"],
  ])("is absent when it is %s", (_name, input) => {
    expect(normalizeImageOcrText(input)).toBeUndefined();
  });

  test("stops at the cap without splitting a character", () => {
    const text = normalizeImageOcrText(
      `abc${"😀".repeat(MAX_IMAGE_OCR_CHARS)}`
    );
    expect(Array.from(text ?? "")).toHaveLength(MAX_IMAGE_OCR_CHARS);
    expect(text?.endsWith("😀")).toBe(true);
  });
});
