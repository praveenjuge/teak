import { describe, expect, test } from "bun:test";
import {
  combineSearchQueries,
  describePriceBound,
  formatSearchQualifier,
  matchesPriceBounds,
  matchesSearchPhrases,
  parseSearchQuery,
  renameFolderInSearchQuery,
} from "../../../shared/search/qualifiers";
import { semanticQueryText } from "../../../shared/search/semantic";

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
    ["site:[::1]", "sites", ["[::1]"]],
    ["site:[2001:db8::1],", "sites", ["[2001:db8::1]"]],
    ["site:http://[::1]:8080/x", "sites", ["[::1]"]],
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

  test.each([
    // [input, prices, canonical]
    ["price:<100", [{ op: "<", amount: 100 }], "price:<100"],
    ["PRICE:>20", [{ op: ">", amount: 20 }], "price:>20"],
    ["price:<=9.99", [{ op: "<=", amount: 9.99 }], "price:<=9.99"],
    ["price:>=010.50", [{ op: ">=", amount: 10.5 }], "price:>=10.5"],
    ["price:=0", [{ op: "=", amount: 0 }], "price:=0"],
    ['price:"<50"', [{ op: "<", amount: 50 }], "price:<50"],
    ["price:<50,", [{ op: "<", amount: 50 }], "price:<50"],
    [
      "price:>20 price:<100 price:>20",
      [
        { op: ">", amount: 20 },
        { op: "<", amount: 100 },
      ],
      "price:>20 price:<100",
    ],
  ])(
    "reads %p as price bounds",
    (input: string, prices: unknown, canonical: string) => {
      const parsed = parseSearchQuery(input);
      expect(parsed.prices).toEqual(prices as typeof parsed.prices);
      expect(parsed.terms).toEqual([]);
      expect(parsed.canonical).toBe(canonical);
      expect(parseSearchQuery(parsed.canonical).prices).toEqual(parsed.prices);
    }
  );

  test.each([
    "price:abc",
    "price:<",
    "price:<1e9",
    "price:<-5",
    "price:100",
    "price:<$50",
    "price:<1,000",
    "price:=<5",
  ])("%p stays a plain word", (input: string) => {
    const parsed = parseSearchQuery(input);
    expect(parsed.prices).toEqual([]);
    expect(parsed.qualifiers).toEqual([]);
    expect(parsed.terms).toEqual([input]);
  });

  test("a price bound is a filter, not words to search by meaning", () => {
    const parsed = parseSearchQuery("desk lamp price:<50");
    expect(parsed.text).toBe("desk lamp");
    expect(semanticQueryText(parsed)).toBe("desk lamp");
    expect(semanticQueryText(parseSearchQuery("price:<50"))).toBe("");
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

describe("combineSearchQueries", () => {
  test.each([
    // Both must match: tags, folders, phrases and words add up.
    ["tag:design", "tag:ui notes", "tag:design tag:ui notes"],
    [
      'folder:reading "deep work"',
      "is:fav",
      'folder:reading is:fav "deep work"',
    ],
    ["", "tag:x", "tag:x"],
    ["tag:x", "", "tag:x"],
    // type: and site: match any of their values, so across the two they
    // intersect.
    ["type:link type:image", "type:link", "type:link"],
    ["type:link", "type:link type:image", "type:link"],
    ["site:a.com site:b.com", "site:B.com", "site:b.com"],
    ["type:link", "site:a.com", "type:link site:a.com"],
    ["tag:x tag:x", "#X", "tag:x"],
    // Price bounds add up, so a smart folder's bound and a typed one make
    // a range.
    ["price:<100", "price:>20", "price:<100 price:>20"],
    ["price:<100", "price:<100 lamp", "price:<100 lamp"],
    ["type:link price:<100", "", "price:<100 type:link"],
  ])("%j with %j", (scope: string, typed: string, combined: string) => {
    expect(combineSearchQueries(scope, typed)).toBe(combined);
  });

  test("searches that cannot both match combine to null", () => {
    expect(combineSearchQueries("type:link", "type:image")).toBeNull();
    expect(combineSearchQueries("site:a.com", "site:b.com")).toBeNull();
  });

  test("the combined search reads back to the same filters", () => {
    const combined = combineSearchQueries(
      'folder:"Reading list" type:link',
      'tag:"a b" "say \\"hi\\""'
    );
    expect(parseSearchQuery(combined ?? "")).toMatchObject({
      folders: ["reading list"],
      types: ["link"],
      tags: ["a b"],
      phrases: ['say "hi"'],
    });
  });
});

describe("matchesPriceBounds", () => {
  const bounds = parseSearchQuery("price:>20 price:<=100").prices;
  test.each([
    [20, false],
    [20.01, true],
    [100, true],
    [100.01, false],
    [undefined, false],
    [null, false],
  ])(
    "amount %p in (20, 100]: %p",
    (amount: number | null | undefined, expected: boolean) => {
      expect(matchesPriceBounds(amount, bounds)).toBe(expected);
    }
  );

  test("= matches the amount exactly, and no bounds match anything", () => {
    const exact = parseSearchQuery("price:=0").prices;
    expect(matchesPriceBounds(0, exact)).toBe(true);
    expect(matchesPriceBounds(0.5, exact)).toBe(false);
    expect(matchesPriceBounds(undefined, [])).toBe(true);
  });

  test.each([
    ["price:<100", "Under 100"],
    ["price:>1500", "Over 1,500"],
    ["price:<=9.99", "9.99 or less"],
    ["price:>=10", "10 or more"],
    ["price:=0", "Exactly 0"],
  ])("%p reads as %p", (query: string, label: string) => {
    const [bound] = parseSearchQuery(query).prices;
    expect(bound && describePriceBound(bound)).toBe(label);
  });
});

describe("renameFolderInSearchQuery", () => {
  test("renames every folder: naming the folder, ignoring case", () => {
    expect(
      renameFolderInSearchQuery(
        "folder:Reading tag:x notes",
        "reading",
        "Reading list"
      )
    ).toBe('folder:"Reading list" tag:x notes');
    expect(
      renameFolderInSearchQuery('FOLDER:"reading"', "reading", "Inbox")
    ).toBe("folder:Inbox");
  });

  test("leaves a search that names other folders as it was", () => {
    const query = "folder:inbox  tag:x";
    expect(renameFolderInSearchQuery(query, "reading", "Later")).toBe(query);
  });
});

describe("like: and mood:", () => {
  const ID = "j979t50bv7gjxz2mazwwf5tes18gbvnt";
  const OTHER = "j97a1vaafgzkxkzag6rb6wt0gs8gbq0x";

  test("reads a card id and a mood, written the canonical way", () => {
    const like = parseSearchQuery(`like:${ID} type:link`);
    expect(like.similarity).toEqual({ kind: "like", cardId: ID });
    expect(like.terms).toEqual([]);
    expect(like.canonical).toBe(`like:${ID} type:link`);
    const mood = parseSearchQuery('MOOD:"moody   brutalist" #design');
    expect(mood.similarity).toEqual({ kind: "mood", text: "moody brutalist" });
    expect(mood.canonical).toBe('mood:"moody brutalist" tag:design');
  });

  test("keeps a malformed id as plain text", () => {
    const parsed = parseSearchQuery("like:not-a-card");
    expect(parsed.similarity).toBeNull();
    expect(parsed.terms).toEqual(["like:not-a-card"]);
  });

  test("keeps one anchor; a second one is plain text", () => {
    const parsed = parseSearchQuery(`like:${ID} like:${OTHER}`);
    expect(parsed.similarity).toEqual({ kind: "like", cardId: ID });
    expect(parsed.terms).toEqual([`like:${OTHER}`]);
    expect(parseSearchQuery(`like:${ID} mood:calm`).terms).toEqual([
      "mood:calm",
    ]);
    // The same anchor twice is one anchor.
    expect(parseSearchQuery(`like:${ID} like:${ID}`).terms).toEqual([]);
  });

  test("a smart folder and a typed search can't name two anchors", () => {
    expect(combineSearchQueries(`like:${ID}`, `like:${OTHER}`)).toBeNull();
    expect(combineSearchQueries(`like:${ID}`, "mood:calm")).toBeNull();
    expect(combineSearchQueries(`like:${ID}`, "chair")).toBe(
      `like:${ID} chair`
    );
    expect(combineSearchQueries("type:link", `like:${ID}`)).toBe(
      `like:${ID} type:link`
    );
    // The same mood in another case is the same anchor.
    expect(combineSearchQueries('mood:"Calm  Blue"', 'mood:"calm blue"')).toBe(
      'mood:"Calm Blue"'
    );
    expect(parseSearchQuery("mood:Calm mood:calm").terms).toEqual([]);
  });
});
