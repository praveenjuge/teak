import { describe, expect, test } from "bun:test";
import {
  CARD_LINK_PATTERN,
  CARD_LINK_TITLE_MAX_LENGTH,
  cardLinkTokensToText,
  formatCardLinkToken,
  MAX_CARD_LINKS,
  parseCardLinkIds,
  replaceCardLinkTokens,
} from "../../shared/cardLinks";

const ID_A = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b";
const ID_B = "k27a8m9x2p3q4r5s6t7u8v9w0y1z2a3b";

describe("parseCardLinkIds", () => {
  test.each([
    ["one link", `See [[Plan|teak:${ID_A}]].`, [ID_A]],
    [
      "order kept, duplicates dropped",
      `[[B|teak:${ID_B}]] then [[A|teak:${ID_A}]] and [[B again|teak:${ID_B}]]`,
      [ID_B, ID_A],
    ],
    ["an empty title", `[[|teak:${ID_A}]]`, [ID_A]],
    ["inline code", `\`[[Plan|teak:${ID_A}]]\``, []],
    ["double-backtick code", `\`\` a [[Plan|teak:${ID_A}]] \`\``, []],
    [
      "a fenced block",
      `\`\`\`\n[[Plan|teak:${ID_A}]]\n\`\`\`\n[[B|teak:${ID_B}]]`,
      [ID_B],
    ],
    ["a tilde fence", `~~~md\n[[Plan|teak:${ID_A}]]\n~~~`, []],
    [
      "a fenced block with CRLF line endings",
      `\`\`\`\r\n[[Plan|teak:${ID_A}]]\r\n\`\`\`\r\n[[B|teak:${ID_B}]]`,
      [ID_B],
    ],
    [
      "a fence line with an info string inside a block",
      `\`\`\`\n\`\`\`js\n[[Plan|teak:${ID_A}]]\n\`\`\``,
      [],
    ],
    ["an indented block", `Intro\n\n    [[Plan|teak:${ID_A}]]`, []],
    [
      "a list item's indented paragraph",
      `- Item\n\n    [[Plan|teak:${ID_A}]]`,
      [ID_A],
    ],
    [
      "an ordered item's indented continuation",
      `1. Item\n    [[Plan|teak:${ID_A}]]`,
      [ID_A],
    ],
    [
      "a nested item's indented paragraph",
      `- Outer\n    - Inner\n\n      [[Plan|teak:${ID_A}]]`,
      [ID_A],
    ],
    [
      "an indented block inside a list item",
      `- Item\n\n      [[Plan|teak:${ID_A}]]`,
      [],
    ],
    [
      "an indented block after a list ends",
      `- Item\n\nParagraph\n\n    [[Plan|teak:${ID_A}]]`,
      [],
    ],
    ["an unclosed backtick", `\`oops [[Plan|teak:${ID_A}]]`, [ID_A]],
    ["no id", "[[x|teak:]]", []],
    ["no prefix", "[[x]]", []],
    ["an uppercase id", "[[x|teak:K17A8M9X2P3Q4R5S]]", []],
    ["a too-short id", "[[x|teak:abc]]", []],
    ["a pipe in the title", `[[a|b|teak:${ID_A}]]`, []],
    ["a newline in the title", `[[a\nb|teak:${ID_A}]]`, []],
  ])("%s", (_, markdown, ids) => {
    expect(parseCardLinkIds(markdown)).toEqual(ids);
  });

  test("indexes at most 500 distinct targets", () => {
    const tokens = Array.from(
      { length: 501 },
      (_, index) => `[[n|teak:${String(index).padStart(16, "a")}]]`
    ).join(" ");
    const ids = parseCardLinkIds(tokens);
    expect(ids).toHaveLength(MAX_CARD_LINKS);
    expect(ids.at(-1)).toBe(String(499).padStart(16, "a"));
  });

  test("handles missing content", () => {
    expect(parseCardLinkIds(undefined)).toEqual([]);
  });

  test("reads a long line of code spans in linear time", () => {
    const spans = "`a` ".repeat(50_000);
    const unclosed = "``a ".repeat(50_000);
    const markdown = `${spans}[[Plan|teak:${ID_A}]] ${unclosed}\`[[B|teak:${ID_B}]]\``;
    const started = performance.now();
    expect(parseCardLinkIds(markdown)).toEqual([ID_A]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("formatCardLinkToken", () => {
  test("replaces characters the grammar can't hold", () => {
    expect(formatCardLinkToken("a | b ]] c\nd", ID_A)).toBe(
      `[[a b c d|teak:${ID_A}]]`
    );
    expect(formatCardLinkToken("   ", ID_A)).toBe(`[[Card|teak:${ID_A}]]`);
  });

  test.each([
    ["300 characters", "a".repeat(300)],
    ["512 characters", "b".repeat(512)],
    ["ending in emoji", `${"c".repeat(198)}👩‍👩‍👧‍👦👩‍👩‍👧‍👦`],
    ["CJK", "漢字".repeat(150)],
    ["RTL", "שלום ".repeat(80)],
  ])("a %s title reads back with the same id", (_, title) => {
    const token = formatCardLinkToken(title, ID_A);
    const match = CARD_LINK_PATTERN.exec(token);
    expect(match?.[2]).toBe(ID_A);
    expect(match?.[1].length).toBeLessThanOrEqual(CARD_LINK_TITLE_MAX_LENGTH);
    expect(parseCardLinkIds(`x ${token} y`)).toEqual([ID_A]);
    expect(match?.[1]).not.toMatch(/‍…$/u);
  });

  test.each([
    // 185 + the 11-unit family + "ddd" + "…" is exactly 200: the emoji fits.
    [
      "kept whole",
      `${"c".repeat(185)}👩‍👩‍👧‍👦${"d".repeat(30)}`,
      `${"c".repeat(185)}👩‍👩‍👧‍👦ddd…`,
    ],
    // 190 + 11 + "…" would be 202: the whole family is dropped.
    [
      "dropped whole",
      `${"c".repeat(190)}👩‍👩‍👧‍👦${"d".repeat(30)}`,
      `${"c".repeat(190)}…`,
    ],
    [
      "not split at a surrogate",
      `${"c".repeat(198)}😀😀`,
      `${"c".repeat(198)}…`,
    ],
  ])("an emoji at the cut is %s", (_, title, expected) => {
    const stored = CARD_LINK_PATTERN.exec(
      formatCardLinkToken(title, ID_A)
    )?.[1];
    expect(stored).toBe(expected);
    expect(stored?.isWellFormed()).toBe(true);
  });

  test("a short title is kept", () => {
    expect(formatCardLinkToken("Reading list", ID_A)).toBe(
      `[[Reading list|teak:${ID_A}]]`
    );
  });
});

describe("replacing tokens", () => {
  test("shows each link as its stored title, leaving code alone", () => {
    const markdown = `Read [[Plan|teak:${ID_A}]] and \`[[Raw|teak:${ID_B}]]\``;
    expect(cardLinkTokensToText(markdown)).toBe(
      `Read Plan and \`[[Raw|teak:${ID_B}]]\``
    );
  });

  test("passes the title and id to the replacer", () => {
    const seen: string[] = [];
    const result = replaceCardLinkTokens(
      `[[A|teak:${ID_A}]]-[[B|teak:${ID_B}]]`,
      (title, id) => {
        seen.push(`${title}:${id}`);
        return title.toLowerCase();
      }
    );
    expect(result).toBe("a-b");
    expect(seen).toEqual([`A:${ID_A}`, `B:${ID_B}`]);
  });

  test("keeps backticks in a title", () => {
    expect(cardLinkTokensToText(`See [[Use \`foo\`|teak:${ID_A}]].`)).toBe(
      "See Use `foo`."
    );
  });

  test("text with no links is returned as is", () => {
    expect(cardLinkTokensToText("plain [[x]] text")).toBe("plain [[x]] text");
  });
});
