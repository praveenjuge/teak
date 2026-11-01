import { describe, expect, test } from "bun:test";

import {
  type ExpressionCard,
  type ExpressionContext,
  expressionFolderNames,
  expressionIndexWords,
  expressionRevealTags,
  expressionWantsArchived,
  matchesExpression,
  searchOperatorsUsed,
} from "../../../shared/search/expression";
import { parseSearchQuery } from "../../../shared/search/qualifiers";

interface TestCard extends ExpressionCard {
  folders?: string[];
  host?: string;
  tags?: string[];
  text?: string;
}

const matches = (query: string, card: TestCard) => {
  const { expression } = parseSearchQuery(query);
  if (!expression) {
    throw new Error(`"${query}" has no expression`);
  }
  const context: ExpressionContext = {
    folder: (nameKey) => (card.folders ?? []).includes(nameKey),
    hasTag: (tag) => (card.tags ?? []).includes(tag.toLowerCase()),
    host: card.host ?? null,
  };
  return matchesExpression(expression, card, card.text ?? "", context);
};

const revealsHiddenCard = (query: string, card: TestCard) => {
  const { expression } = parseSearchQuery(query);
  if (!expression) {
    throw new Error(`"${query}" has no expression`);
  }
  return matchesExpression(
    expression,
    card,
    card.text ?? "",
    {
      folder: () => false,
      hasTag: (tag) => (card.tags ?? []).includes(tag.toLowerCase()),
      host: null,
    },
    true
  );
};

const note = (overrides: Partial<TestCard> = {}): TestCard => ({
  type: "text",
  ...overrides,
});

describe("matchesExpression leaves", () => {
  test.each([
    ["-figma", note({ text: "Design notes" }), true],
    ["-figma", note({ text: "Figma file" }), false],
    // A word matches inside a longer word, ignoring edge punctuation.
    ["-design", note({ text: "Designer portfolio" }), false],
    ["-design,", note({ text: "Design" }), false],
    ['-"brand guide"', note({ text: "Our Brand Guide" }), false],
    ['-"brand guide"', note({ text: "brand new guide" }), true],
    ["-tag:old", note({ tags: ["old"] }), false],
    ["-#OLD", note({ tags: ["old"] }), false],
    ["-tag:old", note({ tags: ["new"] }), true],
    ["-type:image", note({ type: "image" }), false],
    ["-type:image", note({ type: "link" }), true],
    ["-site:github.com", note({ host: "github.com" }), false],
    ["-site:github.com", note({ host: "gitlab.com" }), true],
    ['-folder:"Reading list"', note({ folders: ["reading list"] }), false],
    ["-folder:Inbox", note({ folders: ["reading list"] }), true],
    ["-is:fav", note({ isFavorited: true }), false],
    ["-is:fav", note(), true],
    ["-is:archived", note({ isArchived: true }), false],
    ["-is:done", note({ type: "link", completedAt: 1 }), false],
    ["-is:done", note({ type: "text", completedAt: 1 }), true],
    ["-price:<100", note({ type: "link" }), true],
    [
      "-price:<100",
      note({
        type: "link",
        metadata: { linkCategory: { price: { amount: 50 } } },
      }),
      false,
    ],
    ['-text:"total due"', note({ aiOcrText: "TOTAL DUE: $40" }), false],
    ['-text:"total due"', note({ aiOcrText: "Paid" }), true],
  ] as const)("%s", (query, card, expected) => {
    expect(matches(query, card)).toBe(expected);
  });
});

describe("matchesExpression operators", () => {
  const fonts = note({ tags: ["fonts"], text: "Inter" });
  const type = note({ tags: ["type"], text: "Serif" });
  const both = note({ tags: ["fonts", "type"], text: "Mono" });
  const neither = note({ tags: ["color"], text: "Palette" });

  test("OR matches either side", () => {
    const query = "tag:fonts OR tag:type";
    expect([fonts, type, both, neither].map((c) => matches(query, c))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  test("a minus binds tighter than OR", () => {
    const query = "-tag:fonts OR tag:type";
    expect([fonts, type, both, neither].map((c) => matches(query, c))).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });

  test("a space binds tighter than OR", () => {
    const query = "tag:fonts -tag:type OR tag:color";
    expect([fonts, type, both, neither].map((c) => matches(query, c))).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  test("parentheses override precedence", () => {
    const query = "tag:fonts (-tag:type OR mono)";
    expect(parseSearchQuery(query).tags).toEqual(["fonts"]);
    expect([fonts, type, both, neither].map((c) => matches(query, c))).toEqual([
      true,
      false,
      true,
      true,
    ]);
    const nested = "(tag:fonts (-tag:type OR mono)) OR palette";
    expect([fonts, type, both, neither].map((c) => matches(nested, c))).toEqual(
      [true, false, true, true]
    );
  });

  test("a minus before a group negates the whole group", () => {
    const query = "-(tag:fonts OR tag:type)";
    expect([fonts, type, both, neither].map((c) => matches(query, c))).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  test("a site group with an exclusion", () => {
    const query = "(site:github.com OR site:gitlab.com) -is:archived";
    expect(matches(query, note({ host: "github.com" }))).toBe(true);
    expect(matches(query, note({ host: "gitlab.com" }))).toBe(true);
    expect(matches(query, note({ host: "codeberg.org" }))).toBe(false);
    expect(matches(query, note({ host: "github.com", isArchived: true }))).toBe(
      false
    );
  });

  test("an impossible search matches nothing", () => {
    const parsed = parseSearchQuery("type:image -type:image");
    expect(parsed.types).toEqual(["image"]);
    expect(matches("type:image -type:image", note({ type: "image" }))).toBe(
      false
    );
    expect(
      matches("(type:image OR x) -type:image", note({ type: "image" }))
    ).toBe(false);
  });
});

describe("expression walkers", () => {
  const expression = (query: string) => parseSearchQuery(query).expression;

  test("folder names are name keys from every leaf", () => {
    expect(
      expressionFolderNames(
        expression('folder:Inbox OR -folder:"Reading List"')
      ).sort()
    ).toEqual(["inbox", "reading list"]);
    expect(expressionFolderNames(undefined)).toEqual([]);
  });

  test("only wanted hidden tags reveal hidden cards", () => {
    expect(expressionRevealTags(expression("tag:hidden OR tag:x"))).toEqual([
      "hidden",
    ]);
    expect(expressionRevealTags(expression("-tag:hidden"))).toEqual([]);
    expect(expressionRevealTags(expression("-(tag:secret OR x)"))).toEqual([]);
    expect(expressionRevealTags(expression("-(-tag:secret OR x)"))).toEqual([
      "secret",
    ]);
    expect(expressionRevealTags(expression("tag:x OR tag:y"))).toEqual([]);
  });

  test("archived cards are read when an expression asks for them", () => {
    expect(expressionWantsArchived(expression("is:archived OR tag:x"))).toBe(
      true
    );
    expect(expressionWantsArchived(expression("-is:archived"))).toBe(false);
    expect(expressionWantsArchived(expression("tag:x OR tag:y"))).toBe(false);
  });

  test("index words leave out excluded words", () => {
    expect(
      expressionIndexWords(expression('design OR "brand guide" -figma'))
    ).toEqual(["design", "brand guide"]);
    expect(expressionIndexWords(expression("-(figma OR sketch)"))).toEqual([]);
  });

  test.each([
    ["-figma", { groups: false, negation: true, or: false }],
    ["a OR b", { groups: false, negation: false, or: true }],
    ["x (a OR b)", { groups: true, negation: false, or: true }],
    ["-(a b)", { groups: true, negation: true, or: false }],
    ["(a OR b) -c", { groups: true, negation: true, or: true }],
    ["(a OR b)", { groups: false, negation: false, or: true }],
    ["design", { groups: false, negation: false, or: false }],
  ] as const)("operators used by %s", (query, used) => {
    expect(searchOperatorsUsed(parseSearchQuery(query))).toEqual(used);
  });
});

describe("matchesExpression for a hidden card", () => {
  const secret = (overrides: Partial<TestCard> = {}) =>
    note({ tags: ["hidden", "design"], ...overrides });

  test.each([
    ["tag:hidden OR tag:x", secret(), true],
    // It matches only through tag:design, which doesn't ask for it.
    ["(tag:hidden is:fav) OR tag:design", secret(), false],
    ["(tag:hidden is:fav) OR tag:design", secret({ isFavorited: true }), true],
    ["tag:design OR tag:x", secret(), false],
    ["-tag:hidden OR tag:design", secret(), false],
    // Two minuses ask for it: secret and not x.
    ["-(-tag:hidden OR tag:x)", secret(), true],
    ["-(-tag:hidden OR tag:design)", secret(), false],
  ] as const)("%s", (query, card, expected) => {
    expect(revealsHiddenCard(query, card)).toBe(expected);
    if (expected) {
      expect(matches(query, card)).toBe(true);
    }
  });
});
