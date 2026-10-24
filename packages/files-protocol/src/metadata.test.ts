import { describe, expect, test } from "bun:test";
import {
  LINK_ANALYSIS_SYSTEM_PROMPT,
  MAX_IMAGE_OCR_CHARS,
  normalizeAiLanguage,
  normalizeImageOcrText,
  parseTextMetadata,
  TEXT_ANALYSIS_SYSTEM_PROMPT,
  validateTextMetadata,
  validationRetryPrompt,
} from "./metadata";

describe("AI tags and summary in the content's language", () => {
  test.each([
    ["text", TEXT_ANALYSIS_SYSTEM_PROMPT],
    ["link", LINK_ANALYSIS_SYSTEM_PROMPT],
  ])("the %s prompt asks for the content's language", (_name, prompt) => {
    expect(prompt).toContain(
      "Write the tags and the summary in the same language as the content"
    );
    expect(prompt).toContain("use English");
    expect(prompt).toContain("one term with no spaces");
    expect(prompt).toContain('Never use "secret" or "hidden"');
    expect(prompt).toContain('"language": "xx"');
  });

  test("a validation retry asks for the language too", () => {
    expect(validationRetryPrompt("Analyze this", 1)).toContain(
      "tags, summary and language"
    );
  });

  test("keeps a valid language beside the tags and summary", () => {
    expect(
      validateTextMetadata({
        tags: ["デザイン", "東京"],
        summary: "東京のデザイン展についてのメモ。",
        language: "ja",
      })
    ).toEqual({
      tags: ["デザイン", "東京"],
      summary: "東京のデザイン展についてのメモ。",
      language: "ja",
    });
  });

  test("an answer without a language still passes, as older prompts gave", () => {
    expect(
      parseTextMetadata('{"tags": ["design"], "summary": "A note."}')
    ).toEqual({ tags: ["design"], summary: "A note." });
  });

  test.each([
    ["a country code", "us"],
    ["a language name", "Japanese"],
    ["a number", 7],
    ["null", null],
    ["undetermined", "und"],
    ["private use", "qaa"],
    ["an empty string", ""],
  ])("drops %s without failing the answer", (_name, language) => {
    const result = validateTextMetadata({
      tags: ["design"],
      summary: "A note.",
      language,
    });
    expect(result).toEqual({ tags: ["design"], summary: "A note." });
  });

  test.each([
    ["ja", "ja"],
    ["ZH", "zh"],
    ["zh-CN", "zh"],
    ["zh-Hans-CN", "zh"],
    ["pt_BR", "pt"],
    [" es ", "es"],
    ["jpn", "ja"],
    ["eng", "en"],
    ["fil", "fil"],
    ["iw", "he"],
    ["kr", "ko"],
    ["JP", "ja"],
    ["cn", "zh"],
  ])("normalizes %p to %p", (input, expected) => {
    expect(normalizeAiLanguage(input)).toBe(expected);
  });
});

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
