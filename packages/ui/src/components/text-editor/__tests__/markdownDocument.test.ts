import { describe, expect, test } from "bun:test";
import {
  hasSameMarkdownMeaning,
  isWithinMarkdownLimit,
  markdownManager,
  prepareMarkdownDocument,
  shouldSaveAsMarkdownNote,
} from "../markdownDocument";

// Failure modes: dropped text/formatting, reordered blocks, broken nesting,
// changed task state/link titles, unsafe URLs, lost unknown syntax, and limits
// counted in characters instead of UTF-8 bytes.
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
    "| Name | State |\n| --- | --- |\n| Alpha | Ready |",
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
  ])("keeps unsupported content editable as literal text: %s", (source) => {
    const prepared = prepareMarkdownDocument(source);
    expect(prepared.literal).toBe(true);
    expect(markdownManager.serialize(prepared.document)).toBe(source);
  });

  test("recognizes equivalent syntax without requiring identical bytes", () => {
    expect(hasSameMarkdownMeaning("__Bold__", "**Bold**")).toBe(true);
    expect(
      hasSameMarkdownMeaning("* First\n* Second", "- First\n- Second")
    ).toBe(true);
  });

  test.each([
    ["First\n\nSecond", "Second\n\nFirst"],
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
      expect(shouldSaveAsMarkdownNote(source)).toBe(false);
    }
  );
  test.each([
    "# Note\n\n[Link](https://example.com)",
    "[Link](https://example.com)",
    "- First\n- Second",
    "**Bold**",
    "![Image](https://example.com/private.png)",
  ])("saves an authored Markdown note as text: %s", (source) => {
    expect(shouldSaveAsMarkdownNote(source)).toBe(true);
  });
});
