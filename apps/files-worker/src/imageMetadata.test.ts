import { expect, test } from "bun:test";
import { parseImageMetadata } from "./imageMetadata";

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
])("image metadata from %s", (_name, raw, expected) => {
  expect(parseImageMetadata(raw)).toEqual(expected);
});
