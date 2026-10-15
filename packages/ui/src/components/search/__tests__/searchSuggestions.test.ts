import { describe, expect, test } from "bun:test";
import {
  buildSearchSuggestions,
  currentSearchToken,
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
    expect(inserts("is:")).toEqual(["is:fav", "is:archived"]);
    expect(inserts("IS:arch")).toEqual(["is:archived"]);
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
    // Typed exactly with nothing longer to offer: the list closes.
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
    // The tags are still offered to pick on purpose.
    expect(inserts("#bad")).toEqual([]);
    expect(
      buildSearchSuggestions("#fff", hexy).suggestions.map((s) => s.insert)
    ).toEqual(["tag:fff", "tag:fffour"]);
    expect(buildSearchSuggestions("#fffo", hexy).completingValue).toBe(true);
    // A bare # picks the top tag on Enter, like `tag:`.
    expect(buildSearchSuggestions("#", hexy).completingValue).toBe(true);
    expect(buildSearchSuggestions("tag:", hexy).completingValue).toBe(true);
  });

  test("#tag completes tags", () => {
    expect(inserts("#dev")).toEqual(["tag:devops"]);
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
    ['folder:"Reading list"', "Folder", "Reading list"],
    ["like:j979t50bv7gjxz2mazwwf5tes18gbvnt", "Similar to", "a card"],
    ['mood:"moody brutalist"', "Mood", "“moody brutalist”"],
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
  });
});
