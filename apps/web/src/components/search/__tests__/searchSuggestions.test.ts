import { describe, expect, test } from "bun:test";
import {
  buildSearchSuggestions,
  currentSearchToken,
  describeKeywordChip,
  describeQualifierChip,
  SEARCH_SUGGESTION_GROUP_LIMIT,
} from "../searchSuggestions";

const sources = {
  tags: [
    { name: "design", count: 12 },
    { name: "web design", count: 3 },
    { name: "devops", count: 2 },
  ],
  folders: [{ name: "Reading list" }, { name: "Design refs" }],
  sites: [
    { host: "github.com", label: "github.com", count: 9 },
    { host: "xn--r8jz45g.jp", label: "例え.jp", count: 1 },
  ],
};

const inserts = (token: string) =>
  buildSearchSuggestions(token, sources).suggestions.map((s) => s.insert);

describe("currentSearchToken", () => {
  test.each([
    ["", 0, ""],
    ["notes site:git", 6, "site:git"],
    ['folder:"Reading li', 0, 'folder:"Reading li'],
    ['a "b c" tag:x', 8, "tag:x"],
    ["trailing ", 9, ""],
  ])("%p", (text: string, start: number, token: string) => {
    expect(currentSearchToken(text)).toEqual({ start, token });
  });
});

describe("buildSearchSuggestions", () => {
  test("nothing for an empty word", () => {
    expect(buildSearchSuggestions("", sources).suggestions).toEqual([]);
  });

  test("a key prefix suggests the key", () => {
    expect(inserts("si")).toEqual(["site:"]);
    expect(buildSearchSuggestions("si", sources).completingValue).toBe(false);
  });

  test("price: is offered with its hint", () => {
    expect(buildSearchSuggestions("pr", sources).suggestions[0]).toMatchObject({
      insert: "price:",
      detail: "Price under or over",
      complete: false,
    });
  });

  test("text: is offered while typing te", () => {
    expect(buildSearchSuggestions("te", sources).suggestions[0]).toMatchObject({
      insert: "text:",
      detail: "Words in images and scans",
      complete: false,
    });
  });

  test("a word suggests keys, tags, folders and sites that match", () => {
    expect(inserts("de")).toEqual([
      "tag:design",
      "tag:devops",
      'tag:"web design"',
      'folder:"Design refs"',
    ]);
  });

  test("values complete after a key, prefix matches first", () => {
    expect(inserts("tag:des")).toEqual(["tag:design", 'tag:"web design"']);
    expect(inserts("site:www.git")).toEqual(["site:github.com"]);
    expect(inserts("site:例")).toEqual(["site:例え.jp"]);
    expect(inserts('folder:"read')).toEqual(['folder:"Reading list"']);
    expect(inserts("type:im")).toEqual(["type:image"]);
    expect(inserts("is:")).toEqual([
      "is:fav",
      "is:archived",
      "is:done",
      "is:todo",
    ]);
    expect(inserts("IS:arch")).toEqual(["is:archived"]);
    expect(inserts("is:fin")).toEqual(["is:done"]);
    expect(inserts("is:to")).toEqual(["is:todo"]);
    expect(buildSearchSuggestions("site:g", sources).completingValue).toBe(
      true
    );
  });

  test("an exact name comes first, then the most used", () => {
    const ranked = {
      tags: [
        { name: "design-systems", count: 2 },
        { name: "designer", count: 1 },
        { name: "design", count: 40 },
      ],
    };
    const names = (token: string) =>
      buildSearchSuggestions(token, ranked).suggestions.map((s) => s.label);
    expect(names("tag:des")).toEqual(["design", "design-systems", "designer"]);
    expect(names("tag:designer")).toEqual([]);
    expect(names("tag:design")).toEqual([
      "design",
      "design-systems",
      "designer",
    ]);
  });

  test("a hex color after # keeps Enter for the color", () => {
    const hexy = {
      tags: [
        { name: "fff", count: 3 },
        { name: "fffour", count: 1 },
      ],
    };
    for (const token of ["#fff", "#FFF", "#3b82f6", "#bad,"]) {
      expect(buildSearchSuggestions(token, hexy).completingValue).toBe(false);
    }
    expect(inserts("#bad")).toEqual([]);
    expect(
      buildSearchSuggestions("#fff", hexy).suggestions.map((s) => s.insert)
    ).toEqual(["tag:fff", "tag:fffour"]);
    expect(buildSearchSuggestions("#fffo", hexy).completingValue).toBe(true);
    expect(buildSearchSuggestions("#", hexy).completingValue).toBe(true);
    expect(buildSearchSuggestions("tag:", hexy).completingValue).toBe(true);
  });

  test("#tag completes tags", () => {
    expect(inserts("#dev")).toEqual(["tag:devops"]);
  });

  test("a reserved tag says it shows hidden cards", () => {
    const withSecret = {
      tags: [
        { name: "secret", count: 4 },
        { name: "secrets", count: 2 },
      ],
    };
    expect(
      buildSearchSuggestions("#secr", withSecret).suggestions.map(
        (suggestion) => [suggestion.label, suggestion.detail]
      )
    ).toEqual([
      ["secret", "Shows hidden cards · 4"],
      ["secrets", "2"],
    ]);
  });

  test("a value typed exactly closes the list", () => {
    expect(inserts("site:github.com")).toEqual([]);
  });

  test("each group shows at most eight rows", () => {
    const many = {
      tags: Array.from({ length: 20 }, (_, index) => ({
        name: `tag${index}`,
        count: 1,
      })),
    };
    expect(buildSearchSuggestions("tag:", many).suggestions.length).toBe(
      SEARCH_SUGGESTION_GROUP_LIMIT
    );
  });
});

describe("describeQualifierChip", () => {
  test.each([
    ["site:xn--r8jz45g.jp", "Site", "例え.jp"],
    ["tag:design", "Tag", "design"],
    ["type:link", "Type", "Link"],
    ["is:fav", "Show", "Favorites"],
    ["is:archived", "Show", "Archived"],
    ["is:finished", "Show", "Done"],
    ["is:to-do", "Show", "To do"],
    ['folder:"Reading list"', "Folder", "Reading list"],
    ["like:j979t50bv7gjxz2mazwwf5tes18gbvnt", "Similar to", "a card"],
    ['mood:"moody brutalist"', "Mood", "“moody brutalist”"],
    ["price:<100", "Price", "Under 100"],
    ["price:>=1250.5", "Price", "1,250.5 or more"],
    ["price:=0", "Price", "Exactly 0"],
    ['text:"Total due"', "Text in image", "Total due"],
  ])("%s", (chip: string, title: string, label: string) => {
    expect(describeQualifierChip(chip)).toMatchObject({ title, label });
  });

  test("a like: chip reads its card's title", () => {
    expect(
      describeQualifierChip(
        "like:j979t50bv7gjxz2mazwwf5tes18gbvnt",
        "Concrete tower"
      )
    ).toMatchObject({ title: "Similar to", label: "Concrete tower" });
  });

  test("text that is not a qualifier has no chip", () => {
    expect(describeQualifierChip("notes")).toBeNull();
    expect(describeQualifierChip("price:cheap")).toBeNull();
  });
});

describe("exclusions and OR", () => {
  test("a minus offers the filters it can leave out", () => {
    const result = buildSearchSuggestions("-", sources);
    expect(result.suggestions.map((s) => s.insert)).toEqual([
      "-tag:",
      "-type:",
      "-site:",
      "-folder:",
      "-is:",
    ]);
    expect(new Set(result.suggestions.map((s) => s.group))).toEqual(
      new Set(["Exclude"])
    );
    expect(result.suggestions[0]?.detail).toBe("Leave out cards with a tag");
  });

  test("like: and mood: are never offered after a minus", () => {
    expect(inserts("-l")).toEqual([]);
    expect(inserts("-mo")).toEqual([]);
    expect(inserts("-like:")).toEqual([]);
  });

  test("values complete as they do without the minus", () => {
    expect(inserts("-tag:des")).toEqual(["-tag:design", '-tag:"web design"']);
    expect(inserts("-#dev")).toEqual(["-tag:devops"]);
    expect(inserts("-is:arch")).toEqual(["-is:archived"]);
    expect(inserts("-type:ima")).toEqual(["-type:image"]);
    expect(inserts("-git")).toEqual(["-site:github.com"]);
    const values = buildSearchSuggestions("-tag:des", sources);
    expect(values.completingValue).toBe(true);
    expect(values.suggestions.every((s) => s.complete)).toBe(true);
  });

  test("a double minus is a plain word", () => {
    expect(inserts("--")).toEqual([]);
  });

  test("OR is offered only after a word", () => {
    expect(inserts("O")).toEqual([]);
    const afterWord = (token: string) =>
      buildSearchSuggestions(token, sources, { afterWord: true }).suggestions;
    expect(afterWord("O")[0]).toMatchObject({
      detail: "Either side matches",
      insert: "OR ",
      label: "OR",
    });
    expect(afterWord("or")[0]?.insert).toBe("OR ");
    expect(afterWord("ora").map((s) => s.insert)).not.toContain("OR ");
  });
});

describe("excluded chips", () => {
  test("an excluded filter reads as its filter, marked excluded", () => {
    expect(describeQualifierChip("-tag:design")).toMatchObject({
      excluded: true,
      label: "design",
      title: "Tag",
    });
    expect(describeQualifierChip("-is:archived")).toMatchObject({
      excluded: true,
      label: "Archived",
    });
    expect(describeQualifierChip("tag:design")?.excluded).toBeUndefined();
    expect(describeQualifierChip("-figma")).toBeNull();
  });

  test("word chips show exclusions and groups", () => {
    expect(describeKeywordChip("-figma")).toEqual({
      excluded: true,
      label: "figma",
    });
    expect(describeKeywordChip('-"brand guide"')).toEqual({
      excluded: true,
      label: '"brand guide"',
    });
    expect(describeKeywordChip("(tag:a OR b)")).toEqual({
      group: true,
      label: "tag:a OR b",
    });
    expect(describeKeywordChip("design")).toEqual({ label: "design" });
    expect(describeKeywordChip('"exact words"')).toEqual({
      label: '"exact words"',
    });
  });
});
