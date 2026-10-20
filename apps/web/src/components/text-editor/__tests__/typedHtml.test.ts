import { expect, test } from "bun:test";
import { escapeTypedHtml } from "../typedHtml";

test.each([
  ["a tag", "Use <b>bold</b>", "Use &lt;b&gt;bold&lt;/b&gt;"],
  ["a comment", "<!-- hidden -->", "&lt;!-- hidden --&gt;"],
  ["a declaration", "<!DOCTYPE html>", "&lt;!DOCTYPE html&gt;"],
  [
    "a processing instruction",
    '<?xml version="1.0"?>',
    '&lt;?xml version="1.0"?&gt;',
  ],
  ["an autolink", "<https://teakvault.com>", "&lt;https://teakvault.com&gt;"],
  ["a tag still being typed", "Start <div", "Start &lt;div"],
])("escapes %s so it saves as text", (_name, typed, saved) => {
  expect(escapeTypedHtml(typed)).toBe(saved);
});

test.each([
  ["a comparison", "a < b and c > d"],
  ["a code span", "Type `<b>` for bold"],
  ["a fenced code block", "```html\n<b>bold</b>\n```"],
])("leaves %s as typed", (_name, typed) => {
  expect(escapeTypedHtml(typed)).toBe(typed);
});
