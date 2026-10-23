import { describe, expect, test } from "bun:test";
import {
  combineSearchQueries,
  describePriceBound,
  formatSearchExpression,
  formatSearchQualifier,
  matchesDoneState,
  matchesImageText,
  matchesPriceBounds,
  matchesSearchPhrases,
  type PriceBound,
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
    ["is:done", "done", true],
    ["is:Completed", "done", true],
    ["is:finished", "done", true],
    ["is:todo", "todo", true],
    ["is:to-do", "todo", true],
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
    ["text:4411", "ocrTexts", ["4411"]],
    ['TEXT:"Total  Due"', "ocrTexts", ["Total Due"]],
    ["text:Total text:total", "ocrTexts", ["Total"]],
    ["text:a text:b", "ocrTexts", ["a", "b"]],
    ["text:", "terms", []],
    ['text:"  "', "ocrTexts", []],
    ["text:4411", "text", ""],
    ["text:東京駅", "ocrTexts", ["東京駅"]],
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

  test.each<[input: string, prices: PriceBound[], canonical: string]>([
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
  ])("reads %p as price bounds", (input, prices, canonical) => {
    const parsed = parseSearchQuery(input);
    expect(parsed.prices).toEqual(prices);
    expect(parsed.terms).toEqual([]);
    expect(parsed.canonical).toBe(canonical);
    expect(parseSearchQuery(parsed.canonical).prices).toEqual(parsed.prices);
  });

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

describe("text:", () => {
  test("keeps its value's case and quotes in the canonical form", () => {
    expect(
      parseSearchQuery('receipt text:"Total due" text:4411').canonical
    ).toBe('text:"Total due" text:4411 receipt');
    expect(formatSearchQualifier({ key: "text", value: 'say "hi"' })).toBe(
      'text:"say \\"hi\\""'
    );
  });

  test("is a filter, not words to search by meaning", () => {
    expect(semanticQueryText(parseSearchQuery("text:invoice"))).toBe("");
  });

  test("every value must appear in the image text, across line breaks", () => {
    const text = "ACME\nInvoice 4411\nTotal   DUE";
    expect(matchesImageText(text, ["total due", "4411"])).toBe(true);
    expect(matchesImageText(text, ["4411", "tokyo"])).toBe(false);
    expect(matchesImageText(undefined, ["4411"])).toBe(false);
    expect(matchesImageText(undefined, [])).toBe(true);
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
    ["tag:design", "tag:ui notes", "tag:design tag:ui notes"],
    [
      'folder:reading "deep work"',
      "is:fav",
      'folder:reading is:fav "deep work"',
    ],
    ["", "tag:x", "tag:x"],
    ["tag:x", "", "tag:x"],
    ["type:link type:image", "type:link", "type:link"],
    ["type:link", "type:link type:image", "type:link"],
    ["site:a.com site:b.com", "site:B.com", "site:b.com"],
    ["type:link", "site:a.com", "type:link site:a.com"],
    ["tag:x tag:x", "#X", "tag:x"],
    ["price:<100", "price:>20", "price:<100 price:>20"],
    ["price:<100", "price:<100 lamp", "price:<100 lamp"],
    ["type:link price:<100", "", "price:<100 type:link"],
    ["text:invoice", "text:4411 acme", "text:invoice text:4411 acme"],
    [
      'is:todo folder:"Reading list"',
      "is:done",
      'is:todo folder:"Reading list" is:done',
    ],
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
    expect(combineSearchQueries('mood:"Calm  Blue"', 'mood:"calm blue"')).toBe(
      'mood:"Calm Blue"'
    );
    expect(parseSearchQuery("mood:Calm mood:calm").terms).toEqual([]);
  });
});

describe("is:done and is:todo", () => {
  test("write the one canonical way", () => {
    expect(parseSearchQuery("IS:Finished is:TO-DO lamp").canonical).toBe(
      "is:done is:todo lamp"
    );
  });

  const link = (category: string | undefined, completedAt?: number) => ({
    completedAt,
    metadata: category ? { linkCategory: { category } } : undefined,
  });

  test.each([
    ["a done film", link("movie", 1), { done: true }, true],
    ["a film to watch", link("movie"), { done: true }, false],
    ["a film to watch", link("movie"), { todo: true }, true],
    ["a done film", link("movie", 1), { todo: true }, false],
    ["a repository", link("repo"), { todo: true }, false],
    ["a done repository", link("repo", 1), { done: true }, true],
    ["a link with no category yet", link(undefined), { todo: true }, false],
    ["anything", link("movie"), {}, true],
  ])("%s with %j", (_name, card, query, matches) => {
    expect(matchesDoneState(card, { done: false, todo: false, ...query })).toBe(
      matches
    );
  });
});

describe("search operators", () => {
  const shape = (input: string) => {
    const parsed = parseSearchQuery(input);
    return {
      canonical: parsed.canonical,
      expression: parsed.expression
        ? formatSearchExpression(parsed.expression)
        : undefined,
    };
  };

  test.each([
    ["design -figma", "design -figma", "-figma"],
    ["#inspo -type:image", "tag:inspo -type:image", "-type:image"],
    ["tag:fonts OR tag:type", "tag:fonts OR tag:type", "tag:fonts OR tag:type"],
    [
      "(site:github.com OR site:gitlab.com) -is:archived",
      "(site:github.com OR site:gitlab.com) -is:archived",
      "(site:github.com OR site:gitlab.com) -is:archived",
    ],
    ['-"brand guide" notes', 'notes -"brand guide"', '-"brand guide"'],
    ["-#old", "-tag:old", "-tag:old"],
    [
      "-site:x.com -folder:Inbox",
      "-site:x.com -folder:Inbox",
      "-site:x.com -folder:Inbox",
    ],
    ["-(a OR b) c", "c -(a OR b)", "-(a OR b)"],
  ])("%s reads as %s", (input, canonical, expression) => {
    expect(shape(input)).toEqual({ canonical, expression });
  });

  test("- binds tightest, then a space, then OR", () => {
    expect(shape("a b OR c -d")).toEqual({
      canonical: "a b OR c -d",
      expression: "a b OR c -d",
    });
    const parsed = parseSearchQuery("a b OR c -d");
    expect(parsed.expression).toEqual({
      op: "or",
      items: [
        {
          op: "and",
          items: [
            { op: "term", value: "a" },
            { op: "term", value: "b" },
          ],
        },
        {
          op: "and",
          items: [
            { op: "term", value: "c" },
            { op: "not", item: { op: "term", value: "d" } },
          ],
        },
      ],
    });
  });

  test("an OR beside other words keeps its parentheses", () => {
    expect(parseSearchQuery("x (a OR b)").canonical).toBe("x (a OR b)");
    expect(parseSearchQuery("(a OR b) (c OR d)").canonical).toBe(
      "(a OR b) (c OR d)"
    );
  });

  test.each([
    ["-", ""],
    ["- design", "design"],
    ["OR", ""],
    ["OR OR", ""],
    ["design OR", "design"],
    ["OR design", "design"],
    ["(()", ""],
    [")design(", "design"],
    ["(design", "design"],
    ["design)", "design"],
    ["((a OR b)", "a OR b"],
    ["--design", "--design"],
    ['"-not negated"', '"-not negated"'],
    ["to-do", "to-do"],
    ["e-mail list", "e-mail list"],
    ["price:<-5", "price:<-5"],
    ["design or figma", "design or figma"],
    ['"OR"', '"OR"'],
    ['OR"', '"OR"'],
  ])("forgives %p, reading it as %p", (input, canonical) => {
    expect(parseSearchQuery(input).canonical).toBe(canonical);
  });

  test("a word with a hyphen inside stays one word, not an exclusion", () => {
    const parsed = parseSearchQuery("to-do e-mail");
    expect(parsed.terms).toEqual(["to-do", "e-mail"]);
    expect(parsed.expression).toBeUndefined();
  });

  test("like: and mood: can't be excluded or grouped; they stay words", () => {
    const id = "j97abcdefghijklmnopqrstuvwxyz0123";
    const negated = parseSearchQuery(`-like:${id}`);
    expect(negated.similarity).toBeNull();
    expect(negated.terms).toEqual([`-like:${id}`]);
    expect(negated.expression).toBeUndefined();

    const grouped = parseSearchQuery("mood:calm OR tag:y");
    expect(grouped.similarity).toBeNull();
    expect(grouped.expression).toEqual({
      op: "or",
      items: [
        { op: "term", value: "mood:calm" },
        { op: "qualifier", qualifier: { key: "tag", value: "y" } },
      ],
    });
  });

  test("a query without operators has no expression and reads as before", () => {
    const parsed = parseSearchQuery('tag:a "b c" d (e)');
    expect(parsed.expression).toBeUndefined();
    expect(parsed).toMatchObject({
      tags: ["a"],
      phrases: ["b c"],
      terms: ["d", "e"],
      canonical: 'tag:a "b c" d e',
    });
  });

  test.each([
    ["-(-tag:old)", "-(-tag:old)"],
    ["-(-(-figma))", "-(-(-figma))"],
    ["x -(-(a OR b))", "x -(-(a OR b))"],
  ])("a minus before a minus keeps its group: %s", (input, canonical) => {
    const parsed = parseSearchQuery(input);
    expect(parsed.canonical).toBe(canonical);
    const again = parseSearchQuery(parsed.canonical);
    expect(again.canonical).toBe(canonical);
    expect(again.expression).toEqual(parsed.expression);
  });

  test("top-level words find the matches; excluded words are never searched", () => {
    const parsed = parseSearchQuery('design (figma OR "brand kit") -sketch');
    expect(parsed.terms).toEqual(["design"]);
    expect(parsed.text).toBe("design");
    expect(parseSearchQuery('(figma OR "brand kit") -sketch').text).toBe(
      "figma brand kit"
    );
  });

  test.each([
    ["figma OR sketch", "figma sketch"],
    ["(figma OR sketch) -tag:old", "figma sketch"],
    ["tag:x (figma OR sketch)", "figma sketch"],
    // A card with only `beta` must not come back for `alpha (… OR beta)`.
    ["alpha (tag:keep OR beta)", "alpha"],
    // A card can match these without any of the words, so the search reads
    // by date and checks every card instead.
    ["is:archived OR notes", ""],
    ["tag:x OR figma", ""],
    ["-figma", ""],
    ["-(figma OR sketch)", ""],
    // The top-level word finds every match.
    ["notes (is:archived OR figma)", "notes"],
  ])("%s searches the index for %j", (input, text) => {
    expect(parseSearchQuery(input).text).toBe(text);
  });

  test("groups nest at most 4 deep; deeper parentheses are ignored", () => {
    const parsed = parseSearchQuery("(((((a OR b))))) c");
    expect(parsed.canonical).toBe("c (a OR b)");
    const deep = parseSearchQuery("x (a ((b ((c OR d) e) f) g) h)");
    expect(parseSearchQuery(deep.canonical).canonical).toBe(deep.canonical);
  });

  test("past 64 words and filters, the rest are plain words", () => {
    const words = Array.from({ length: 70 }, (_, index) => `-w${index}`);
    const parsed = parseSearchQuery(words.join(" "));
    const excluded =
      parsed.expression?.op === "and" ? parsed.expression.items.length : 0;
    expect(excluded).toBe(64);
    expect(parsed.terms).toEqual(words.slice(64));
  });

  test("the canonical form parses back to itself", () => {
    for (const input of [
      "design -figma",
      "tag:fonts OR tag:type",
      "(site:github.com OR site:gitlab.com) -is:archived",
      "-(a OR (b -c)) d",
      'x -"y z" (p OR q OR -r)',
      "a OR b c OR d",
    ]) {
      const canonical = parseSearchQuery(input).canonical;
      expect(parseSearchQuery(canonical).canonical).toBe(canonical);
    }
  });

  const randomQueries = (pieces: string[], count: number) => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    return Array.from({ length: count }, () =>
      Array.from(
        { length: next() % 14 },
        () => pieces[next() % pieces.length]
      ).join(next() % 2 ? " " : "")
    );
  };

  test("never throws on random input, quotes included", () => {
    for (const input of randomQueries(
      ["(", ")", "-", "OR", '"', "“", "\\", "a", "tag:x", "#y", "like:", " "],
      2000
    )) {
      expect(() => parseSearchQuery(input)).not.toThrow();
    }
  });

  test("its canonical form is stable on random operator soup", () => {
    const pieces = [
      "(",
      ")",
      "-",
      "OR",
      "or",
      "a",
      "tag:x",
      "#y",
      "-z",
      "type:image",
      " ",
      "  ",
      "price:<5",
      "is:fav",
      "mood:calm",
    ];
    for (const input of randomQueries(pieces, 2000)) {
      const canonical = parseSearchQuery(input).canonical;
      expect(parseSearchQuery(canonical).canonical).toBe(canonical);
    }
  });
});

describe("combineSearchQueries with operators", () => {
  test("each side's OR stays its own group", () => {
    expect(combineSearchQueries("tag:fonts OR tag:type", "a OR b")).toBe(
      "(tag:fonts OR tag:type) (a OR b)"
    );
    expect(combineSearchQueries("tag:fonts OR tag:type", "-tag:fonts")).toBe(
      "(tag:fonts OR tag:type) -tag:fonts"
    );
  });

  test("types and sites still intersect alongside an expression", () => {
    expect(combineSearchQueries("type:image -is:fav", "type:link")).toBeNull();
    expect(combineSearchQueries("type:image -is:fav", "type:image x")).toBe(
      "type:image x -is:fav"
    );
  });
});

describe("renameFolderInSearchQuery with operators", () => {
  test("renames a folder inside an exclusion or an OR group", () => {
    expect(
      renameFolderInSearchQuery(
        "-folder:inbox (folder:Inbox OR tag:x)",
        "inbox",
        "Later"
      )
    ).toBe("-folder:Later (folder:Later OR tag:x)");
  });
});
