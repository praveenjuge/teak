import { describe, expect, test } from "bun:test";
import {
  formatSearchQualifier,
  matchesSearchPhrases,
  parseSearchQuery,
} from "../../../shared/search/qualifiers";

describe("parseSearchQuery", () => {
  test("reads every qualifier, phrases and words", () => {
    const parsed = parseSearchQuery(
      'tag:design type:link site:github.com "design system" notes'
    );
    expect(parsed).toMatchObject({
      tags: ["design"],
      types: ["link"],
      sites: ["github.com"],
      phrases: ["design system"],
      terms: ["notes"],
      text: "notes design system",
      favorite: false,
      archived: false,
      canonical: 'tag:design type:link site:github.com "design system" notes',
    });
  });

  test.each([
    // [input, field, expected]
    ["#Design", "tags", ["design"]],
    ["TAG:Design", "tags", ["design"]],
    ['tag:"Design Systems"', "tags", ["design systems"]],
    ["#fff", "tags", []],
    ["#fff", "terms", ["#fff"]],
    ["#3B82F6,", "terms", ["#3B82F6,"]],
    ["#bad", "terms", ["#bad"]],
    ["tag:bad", "tags", ["bad"]],
    ["#design-ops", "tags", ["design-ops"]],
    ["#", "terms", []],
    ["type:links", "types", ["link"]],
    ["Type:IMAGE", "types", ["image"]],
    ["type:banana", "terms", ["type:banana"]],
    ["type:", "terms", []],
    ["is:fav", "favorite", true],
    ["is:favourites", "favorite", true],
    ["is:starred", "favorite", true],
    ["is:archived", "archived", true],
    ["is:nope", "terms", ["is:nope"]],
    ["site:www.Example.com", "sites", ["example.com"]],
    ["site:https://example.com/path:8080", "sites", ["example.com"]],
    ["site:example.com:8080", "sites", ["example.com"]],
    ["site:例え.jp", "sites", ["xn--r8jz45g.jp"]],
    ["site:mailto:x@y.z", "terms", ["site:mailto:x@y.z"]],
    ['folder:"Reading list"', "folders", ["reading list"]],
    ["folder:Inbox,", "folders", ["inbox"]],
    ["foo:bar", "terms", ["foo:bar"]],
    ["https://github.com", "terms", ["https://github.com"]],
    ['"unbalanced phrase', "phrases", ["unbalanced phrase"]],
    ["“smart quotes”", "phrases", ["smart quotes"]],
    ['""', "phrases", []],
    ["tag:a tag:A #a", "tags", ["a"]],
    ["site:a.com site:b.com", "sites", ["a.com", "b.com"]],
    ["🎨 #🎨", "tags", ["🎨"]],
  ])("%s → %s %p", (input: string, field: string, expected: unknown) => {
    expect(parseSearchQuery(input)[field as "tags"]).toEqual(
      expected as string[]
    );
  });

  test("quoted values keep escaped quotes and round-trip", () => {
    const parsed = parseSearchQuery('folder:"Say \\"hi\\" now" tag:x');
    expect(parsed.qualifiers).toEqual([
      { key: "folder", value: 'Say "hi" now' },
      { key: "tag", value: "x" },
    ]);
    expect(parsed.canonical).toBe('folder:"Say \\"hi\\" now" tag:x');
    expect(parseSearchQuery(parsed.canonical).qualifiers).toEqual(
      parsed.qualifiers
    );
  });

  test.each([
    "A\\B",
    'Say "hi"',
    "<b>Not bold</b> & “quoted”",
    "trailing\\",
    "Ideas!",
    "[Inbox]",
    "(notes)",
  ])("folder name %p round-trips through its chip", (name: string) => {
    const chip = formatSearchQualifier({ key: "folder", value: name });
    expect(parseSearchQuery(chip).qualifiers).toEqual([
      { key: "folder", value: name },
    ]);
  });

  test.each([".net", "c++,", "ok?"])(
    "tag %p round-trips through its chip",
    (tag: string) => {
      const chip = formatSearchQualifier({ key: "tag", value: tag });
      expect(parseSearchQuery(chip).tags).toEqual([tag]);
    }
  );

  test("plain values stay unquoted", () => {
    expect(formatSearchQualifier({ key: "tag", value: "design" })).toBe(
      "tag:design"
    );
    expect(formatSearchQualifier({ key: "folder", value: "c++" })).toBe(
      "folder:c++"
    );
  });

  test("a phrase with quotes round-trips through the canonical form", () => {
    const parsed = parseSearchQuery('"say \\"hi\\" there"');
    expect(parsed.phrases).toEqual(['say "hi" there']);
    expect(parseSearchQuery(parsed.canonical).phrases).toEqual([
      'say "hi" there',
    ]);
  });

  test("the canonical form puts qualifiers first and shows Unicode hosts", () => {
    expect(
      parseSearchQuery('notes "a b" IS:FAV site:WWW.例え.jp #Design').canonical
    ).toBe('is:fav site:例え.jp tag:design "a b" notes');
  });

  test("an empty search parses to nothing", () => {
    expect(parseSearchQuery("   ")).toMatchObject({
      qualifiers: [],
      terms: [],
      phrases: [],
      text: "",
      canonical: "",
    });
  });
});

describe("matchesSearchPhrases", () => {
  test("every phrase must appear, ignoring case", () => {
    expect(
      matchesSearchPhrases("A Design System primer", ["design system"])
    ).toBe(true);
    expect(matchesSearchPhrases("design, system", ["design system"])).toBe(
      false
    );
    expect(matchesSearchPhrases("anything", [])).toBe(true);
  });
});
