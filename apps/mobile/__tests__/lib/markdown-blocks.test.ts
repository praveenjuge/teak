import { describe, expect, test } from "bun:test";
import { parseMarkdownBlocks } from "../../lib/markdown-blocks";

describe("markdown blocks", () => {
  test("splits a note into the blocks the web shows", () => {
    const note = [
      "# Trip plan",
      "",
      "- Book **train** tickets",
      "  - Window seat",
      "1. Pack",
      "",
      "> Leave early.",
      "> Really.",
      "",
      "---",
      "",
      "```",
      "# not a heading",
      "```",
      "Plain line one",
      "line two #travel",
    ].join("\n");

    expect(parseMarkdownBlocks(note)).toEqual([
      { kind: "heading", level: 1, text: "Trip plan" },
      {
        kind: "list",
        items: [
          { depth: 0, marker: "•", text: "Book **train** tickets" },
          { depth: 1, marker: "•", text: "Window seat" },
          { depth: 0, marker: "1.", text: "Pack" },
        ],
      },
      { kind: "quote", text: "Leave early.\nReally." },
      { kind: "rule" },
      { kind: "code", text: "# not a heading" },
      { kind: "paragraph", text: "Plain line one\nline two #travel" },
    ]);
  });

  test("leaves plain text and hashtags as a paragraph", () => {
    expect(parseMarkdownBlocks("#tag is not a heading\r\nnext")).toEqual([
      { kind: "paragraph", text: "#tag is not a heading\nnext" },
    ]);
  });
});
