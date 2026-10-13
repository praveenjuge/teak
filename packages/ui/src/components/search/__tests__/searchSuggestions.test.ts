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
  ])("%s", (chip: string, title: string, label: string) => {
    expect(describeQualifierChip(chip)).toMatchObject({ title, label });
  });

  test("text that is not a qualifier has no chip", () => {
    expect(describeQualifierChip("notes")).toBeNull();
  });
});
