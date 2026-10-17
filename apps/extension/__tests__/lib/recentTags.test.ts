/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearRecentTags,
  MAX_RECENT_TAGS,
  mergeRecentTags,
  readRecentTags,
  rememberTags,
  suggestTags,
} from "../../lib/recentTags";
import { installChromeStorage } from "../helpers/chromeStorage";

const originalChrome = globalThis.chrome;

beforeEach(() => {
  installChromeStorage();
});

afterEach(() => {
  globalThis.chrome = originalChrome;
});

describe("mergeRecentTags", () => {
  test("puts the tags just used first, without repeats ignoring case", () => {
    expect(
      mergeRecentTags(["Design", " ideas "], ["ideas", "Reading"])
    ).toEqual(["Design", "ideas", "Reading"]);
  });

  test("keeps at most 20", () => {
    const remembered = Array.from({ length: 30 }, (_, index) => `old-${index}`);
    const merged = mergeRecentTags(["new"], remembered);
    expect(merged).toHaveLength(MAX_RECENT_TAGS);
    expect(merged[0]).toBe("new");
    expect(merged.at(-1)).toBe("old-18");
  });
});

describe("remembered tags", () => {
  test("belong to the signed-in user", async () => {
    await rememberTags("user_a", ["design"]);
    await rememberTags("user_a", ["reading", "design"]);
    expect(await readRecentTags("user_a")).toEqual(["reading", "design"]);
    expect(await readRecentTags("user_b")).toEqual([]);
  });

  test("are cleared on sign out", async () => {
    await rememberTags("user_a", ["design"]);
    await clearRecentTags();
    expect(await readRecentTags("user_a")).toEqual([]);
  });
});

describe("suggestTags", () => {
  const library = Array.from({ length: 2000 }, (_, index) => `tag-${index}`);

  test("offers recent tags, then the library's, at most 8", () => {
    expect(
      suggestTags({
        library,
        query: "",
        recent: ["design", "tag-0"],
        selected: [],
      })
    ).toEqual([
      "design",
      "tag-0",
      "tag-1",
      "tag-2",
      "tag-3",
      "tag-4",
      "tag-5",
      "tag-6",
    ]);
  });

  test("narrows to what's typed and leaves out the card's own tags", () => {
    expect(
      suggestTags({
        library: ["Design systems", "design", "Reading"],
        query: "DES",
        recent: ["designers"],
        selected: ["Design"],
      })
    ).toEqual(["designers", "Design systems"]);
  });

  test("offers nothing when the user has no tags", () => {
    expect(
      suggestTags({ library: [], query: "", recent: [], selected: [] })
    ).toEqual([]);
  });
});
