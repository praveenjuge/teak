import { describe, expect, test } from "bun:test";
import {
  hasSameMarkdownMeaning,
  isWithinMarkdownLimit,
  markdownManager,
  noteCaptureSavedMessage,
  prepareMarkdownDocument,
  prepareNoteCapture,
} from "../markdownDocument";

const fixtures = [
  ["headings", "# Title\n\n## Section\n\n### Detail"],
  ["paragraph boundaries", "First paragraph\n\nSecond paragraph"],
  ["nested lists", "- Parent\n  - Child\n- Sibling"],
  ["ordered start", "3. Third\n4. Fourth"],
  ["tasks", "- [ ] Pending\n- [x] Done"],
  ["nested tasks", "- [ ] Parent\n  - [x] Child"],
  ["quotes", "> First\n>\n> Second"],
  ["code language and literals", "```ts\nconst x = '<script>';\n```"],
  ["inline formatting", "**Bold** *italic* ~~strike~~ `code`"],
  ["escaped punctuation", "\\*literal\\* and \\[brackets\\]"],
  ["Unicode", "தமிழ் 👩🏽‍💻 café"],
  ["entities", "Fish &amp; chips &lt;3"],
  ["hard breaks", "First  \nSecond"],
  ["links", "[Teak](https://teakvault.com)"],
  ["divider", "Before\n\n---\n\nAfter"],
  ["a table", "| Name | State |\n| --- | --- |\n| Alpha | Ready |"],
  [
    "a table with escaped pipes",
    "| Name | State |\n| --- | --- |\n| a \\| b | `x \\| y` |",
  ],
  ["a table without outer pipes", "Name | State\n--- | ---\nAlpha | Ready"],
  [
    "inline formatting in cells",
    "| **Bold** | `code` | [Teak](https://teakvault.com) |\n| --- | --- | --- |\n| *em* | ~~gone~~ | 東京 مرحبا |",
  ],
  ["empty cells", "| A |  |\n| --- | --- |\n|  | B |"],
  ["two tables back to back", "| A |\n| --- |\n| 1 |\n\n| B |\n| --- |\n| 2 |"],
  [
    "a table between a checklist and text",
    "- [ ] Pending\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter",
  ],
] as const;

describe("Markdown compatibility", () => {
  test.each(["", "\n", "  "])(
    "starts a blank rich draft without rewriting %s",
    (source) => {
      expect(prepareMarkdownDocument(source).literal).toBe(false);
    }
  );
  test.each(fixtures)("preserves %s through rich editing", (_name, source) => {
    const prepared = prepareMarkdownDocument(source);
    expect(prepared.literal).toBe(false);
    if (prepared.literal) {
      throw new Error(`Unexpected source fallback: ${source}`);
    }
    expect(
      hasSameMarkdownMeaning(
        source,
        markdownManager.serialize(prepared.document)
      )
    ).toBe(true);
  });

  test.each([
    "| Name | State |\n| :--- | ---: |\n| Alpha | Ready |",
    "| Name | State |\n| --- | :---: |\n| Alpha | Ready |",
    "| Name | State |\n| --- | --- |\n| Alpha |",
    "| Name | State |\n| --- | --- |\n| Alpha | Ready | Extra |",
    "| Name | State |\n| --- | --- |\n| <b>Alpha</b> | Ready |",
    "> | A |\n> | --- |\n> | 1 |",
    "- | A |\n  | --- |\n  | 1 |",
    "---\ntitle: Keep me\n---\n\nBody",
    "![Private image](https://private.example/image.png)",
    "[label][ref]\n\n[ref]: https://example.com",
    "[ref]: https://example.com",
    "Body\n\n[ref]: https://example.com",
    '[label][ref]\n\n[ref]: https://example.com "Title"',
    "<script>alert(1)</script>",
    '<img src="https://private.example/image.png" onerror="alert(1)">',
    "[unsafe](javascript:alert%281%29)",
    "[unsafe](data:text/html,hello)",
    "[relative](../private)",
    "Footnote[^a]\n\n[^a]: Preserve this",
  ])(
    "keeps unsupported content, images and raw HTML as inert literal text: %s",
    (source) => {
      const prepared = prepareMarkdownDocument(source);
      expect(prepared.literal).toBe(true);
      expect(markdownManager.serialize(prepared.document)).toBe(source);
    }
  );

  test("recognizes equivalent syntax without requiring identical bytes", () => {
    expect(hasSameMarkdownMeaning("__Bold__", "**Bold**")).toBe(true);
    expect(
      hasSameMarkdownMeaning("* First\n* Second", "- First\n- Second")
    ).toBe(true);
  });

  test("reads a table the same whatever its padding and outer pipes", () => {
    expect(
      hasSameMarkdownMeaning(
        "A|B\n-|-\n1|2",
        "| A   | B   |\n| --- | --- |\n| 1   | 2   |"
      )
    ).toBe(true);
  });

  test.each([
    ["First\n\nSecond", "Second\n\nFirst"],
    [
      "| A | B |\n| --- | --- |\n| 1 | 2 |",
      "| A | B |\n| --- | --- |\n| 2 | 1 |",
    ],
    ["| A |\n| --- |\n| 1 |", "| A |\n| --- |\n| 1 |\n| 2 |"],
    ["First\n\nSecond", "First Second"],
    ["**Bold**", "Bold"],
    ["- Parent\n  - Child", "- Parent\n- Child"],
    ["- [x] Done", "- [ ] Done"],
    ["[link](https://a.example)", "[link](https://b.example)"],
    ["```ts\ncode\n```", "```js\ncode\n```"],
    [
      '[link](https://a.example "Title")',
      '[link](https://a.example "Changed")',
    ],
  ])("detects meaning lost from %s", (before, after) => {
    expect(hasSameMarkdownMeaning(before, after)).toBe(false);
  });

  test("counts multibyte content against the byte limit", () => {
    expect(isWithinMarkdownLimit("a".repeat(512 * 1024))).toBe(true);
    expect(isWithinMarkdownLimit("a".repeat(512 * 1024 + 1))).toBe(false);
    expect(isWithinMarkdownLimit("é".repeat(256 * 1024))).toBe(true);
    expect(isWithinMarkdownLimit(`${"é".repeat(256 * 1024)}a`)).toBe(false);
    expect(prepareMarkdownDocument("a".repeat(512 * 1024 + 1)).literal).toBe(
      true
    );
  });

  test.each(["https://example.com", "#ff0000", "> A quote", "Plain text"])(
    "keeps automatic capture classification for %s",
    (source) => {
      expect(prepareNoteCapture(source)).toEqual({ content: source });
    }
  );
  test.each([
    "https://cendyne.dev/posts/2026-10-11-fable-took-my-jorb.html",
    "https://example.com/search?q=teak&page=2",
    "https://en.wikipedia.org/wiki/Teak_(disambiguation)",
  ])("captures a pasted URL as that bare URL: %s", (url) => {
    const pasted = markdownManager.serialize(
      prepareMarkdownDocument(url).document
    );
    expect(prepareNoteCapture(pasted)).toEqual({ content: url });
  });
  test.each([
    "# Note\n\n[Link](https://example.com)",
    "[Link](https://example.com)",
    '[https://example.com](https://example.com "Title")',
    "[**https://example.com**](https://example.com)",
    "[https://example.com](https://example.com) and more",
    "- First\n- Second",
    "**Bold**",
    "![Image](https://example.com/private.png)",
  ])("saves an authored Markdown note as text: %s", (source) => {
    expect(prepareNoteCapture(source)).toEqual({
      content: source,
      type: "text",
    });
  });
  // Bug 29: the composer said "Note saved" for links, quotes and palettes.
  test.each([
    ["https://example.com", "Link saved"],
    ["Read this https://example.com later", "Link saved"],
    ["[https://example.com](https://example.com)", "Link saved"],
    ["**Bold** https://example.com", "Saved"],
    ["Plain text", "Saved"],
    ["#ff0000 #00ff00", "Saved"],
    ['"To be or not to be"', "Saved"],
  ])("tells what saving %p made", (source, message) => {
    expect(noteCaptureSavedMessage(prepareNoteCapture(source))).toBe(message);
  });
});

describe("[[…]] card links", () => {
  const id = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b";

  test.each([
    ["inline", `See [[Garden plan|teak:${id}]] today`],
    ["in a list", `- [[A|teak:${id}]]\n- two`],
    ["in a heading, spacing kept", `# Head [[A  b|teak:${id}]]`],
    ["several", `[[A|teak:${id}]] and [[B|teak:${id.replace("k1", "k2")}]]`],
  ])(
    "a note with a link %s stays rich and round-trips exactly",
    (_, source) => {
      const prepared = prepareMarkdownDocument(source);
      expect(prepared.literal).toBe(false);
      expect(markdownManager.serialize(prepared.document)).toBe(source);
      expect(
        JSON.stringify(prepared.document).match(/"type":"cardLink"/g)
      ).toHaveLength(source.split("[[").length - 1);
    }
  );

  test("a token in code stays code, not a pill", () => {
    const source = `\`[[A|teak:${id}]]\` code`;
    const prepared = prepareMarkdownDocument(source);
    expect(prepared.literal).toBe(false);
    expect(JSON.stringify(prepared.document)).not.toContain("cardLink");
    expect(markdownManager.serialize(prepared.document)).toBe(source);
  });

  test("a pill serializes to a valid token whatever its title", () => {
    expect(
      markdownManager.serialize({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "cardLink", attrs: { cardId: id, title: "a | b ]]" } },
            ],
          },
        ],
      })
    ).toBe(`[[a b|teak:${id}]]`);
  });
});
