import { expect, test } from "bun:test";
import { MAX_IMAGE_OCR_CHARS } from "@teak/files-protocol";
import {
  MAX_IMAGE_METADATA_VALIDATION_RETRIES,
  parseImageMetadata,
  validationRetryPrompt,
} from "./imageMetadata";

test.each([
  [
    "a fenced object, dropping unknown keys and trimming the summary",
    '```json\n{"tags":["red","square"],"summary":"  A red square. ","mood":"calm"}\n```',
    { summary: "A red square.", tags: ["red", "square"] },
  ],
  ["no tags", '{"tags":[],"summary":"A red square."}', null],
  ["a tag that is not a string", '{"tags":["red",1],"summary":"A."}', null],
  ["a blank summary", '{"tags":["red"],"summary":"   "}', null],
  ["an array", '[{"tags":["red"],"summary":"A."}]', null],
  ["text that is not JSON", "A red square.", null],
  [
    "an answer without text, from an older prompt",
    '{"tags":["red"],"summary":"A red square."}',
    { summary: "A red square.", tags: ["red"] },
  ],
  [
    "an empty text",
    '{"tags":["red"],"summary":"A red square.","text":""}',
    { summary: "A red square.", tags: ["red"], text: "" },
  ],
  [
    "text that is only noise",
    '{"tags":["red"],"summary":"A red square.","text":" — · "}',
    { summary: "A red square.", tags: ["red"], text: "" },
  ],
  [
    "text read from a receipt, tidied",
    '{"tags":["receipt"],"summary":"A receipt.","text":"Invoice   4411\\r\\nTotal due: $12  "}',
    {
      summary: "A receipt.",
      tags: ["receipt"],
      text: "Invoice 4411\nTotal due: $12",
    },
  ],
  [
    "fenced text",
    '```json\n{"tags":["sign"],"summary":"A sign.","text":"出口 Exit"}\n```',
    { summary: "A sign.", tags: ["sign"], text: "出口 Exit" },
  ],
  ["text that is a number", '{"tags":["red"],"summary":"A.","text":42}', null],
  ["text that is null", '{"tags":["red"],"summary":"A.","text":null}', null],
])("image metadata from %s", (_name, raw, expected) => {
  expect(parseImageMetadata(raw)).toEqual(expected);
});

test("text longer than the cap is cut, not rejected", () => {
  const text = "word ".repeat(1000);
  const parsed = parseImageMetadata(
    JSON.stringify({ summary: "A wall of text.", tags: ["text"], text })
  );
  expect(parsed?.text).toHaveLength(MAX_IMAGE_OCR_CHARS - 1);
  expect(parsed?.text?.startsWith("word word")).toBe(true);
});

test("a retry asks for less text, and the last one for none", () => {
  expect(validationRetryPrompt("Analyze", 0)).toBe("Analyze");
  expect(validationRetryPrompt("Analyze", 1)).toContain(
    "text cut to at most 1000 characters"
  );
  expect(
    validationRetryPrompt("Analyze", MAX_IMAGE_METADATA_VALIDATION_RETRIES)
  ).toContain('text set to ""');
});
