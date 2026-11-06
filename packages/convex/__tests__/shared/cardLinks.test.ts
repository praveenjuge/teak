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
import { loadFixture } from "./loadFixture.test-utils";

interface CardLinkFixtures {
  formatToken: { id: string; name: string; title: string; token: string }[];
  parseIds: { ids: string[]; markdown: string; name: string }[];
  tokensToText: { markdown: string; name: string; text: string }[];
}

const fixtures = loadFixture<CardLinkFixtures>("cardLinks");

const ID_A = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b";
const ID_B = "k27a8m9x2p3q4r5s6t7u8v9w0y1z2a3b";

describe("parseCardLinkIds", () => {
  test.each(fixtures.parseIds)("$name", ({ markdown, ids }) => {
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
  test.each(fixtures.formatToken)("$name", ({ title, id, token }) => {
    expect(formatCardLinkToken(title, id)).toBe(token);
    expect(CARD_LINK_PATTERN.exec(token)?.[1].isWellFormed()).toBe(true);
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
});

describe("replacing tokens", () => {
  test.each(fixtures.tokensToText)("$name", ({ markdown, text }) => {
    expect(cardLinkTokensToText(markdown)).toBe(text);
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
});
