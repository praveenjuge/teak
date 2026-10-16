import { expect, test } from "bun:test";
import { countWords, formatWordCount } from "../wordCount";

test.each([
  ["an empty note", "", 0],
  ["whitespace", "   \n\n  ", 0],
  ["plain English", "Write the first draft fast.", 5],
  [
    "Markdown syntax",
    "# Title\n\n- **bold** item\n- [a link](https://example.com)",
    5,
  ],
  [
    "a code block's words",
    "Before\n\n```ts\nconst ready = true;\n```\n\nAfter",
    5,
  ],
  ["Arabic, right to left", "هذه ملاحظة قصيرة", 3],
  ["emoji between words", "Ship it 🚀 today", 3],
  [
    "numbers, and a hyphenated word as two",
    "Version 2 of the long-term plan",
    7,
  ],
] as const)("counts %s", (_name, markdown, expected) => {
  expect(countWords(markdown)).toBe(expected);
});

// Written without spaces, so a whitespace split would count each as one word;
// the exact split is the dictionary's, which varies a little by ICU version.
test.each([
  ["Japanese", "東京の朝は静かです"],
  ["Chinese", "这是一段中文笔记"],
] as const)(
  "splits %s into words, not characters or one blob",
  (_name, text) => {
    const count = countWords(text);
    expect(count).toBeGreaterThan(2);
    expect(count).toBeLessThan(Array.from(text).length);
  }
);

test("counts a whole long note, not only its start", () => {
  const note = Array.from(
    { length: 2000 },
    () => "five words in this line"
  ).join("\n");
  expect(countWords(note)).toBe(10_000);
});

test.each([
  [0, "0 words"],
  [1, "1 word"],
  [2, "2 words"],
  [50_000, "50,000 words"],
] as const)("formats %p as %p", (count, expected) => {
  expect(formatWordCount(count)).toBe(expected);
});
