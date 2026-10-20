import { describe, expect, test } from "bun:test";
import type { Id } from "@teak/convex/_generated/dataModel";
import {
  buildSmartFolderQuery,
  decodeFolderSegment,
  type FolderSummary,
  filterFolders,
  folderIdForPath,
  folderPath,
  hasFolderNamed,
  manualFolders,
  suggestSmartFolderName,
} from "../folders";

const folder = (id: string, name: string): FolderSummary => ({
  _id: id as Id<"folders">,
  activeCardCount: 0,
  createdAt: 0,
  kind: "manual",
  name,
  updatedAt: 0,
});

const FOLDERS = [
  folder("f1", "Reading list"),
  folder("f2", "Moodboard"),
  folder("f3", "東京のアイデア"),
];

describe("folder paths", () => {
  test("a folder's path reads back as its id", () => {
    expect(folderIdForPath(folderPath("abc123"))).toBe("abc123");
    expect(folderIdForPath("/f/abc123/")).toBe("abc123");
  });

  test("other pages and nested paths are not folders", () => {
    expect(folderIdForPath("/")).toBeNull();
    expect(folderIdForPath("/archive")).toBeNull();
    expect(folderIdForPath("/f/")).toBeNull();
    expect(folderIdForPath("/f/a/b")).toBeNull();
    expect(folderIdForPath(null)).toBeNull();
  });

  test("a mangled escape in the address does not throw", () => {
    expect(folderIdForPath("/f/%E0")).toBe("%E0");
  });
});

describe("filterFolders", () => {
  test("matches part of a name ignoring case, and keeps all for no query", () => {
    expect(filterFolders(FOLDERS, " READ ").map((f) => f._id)).toEqual(["f1"]);
    expect(filterFolders(FOLDERS, "アイデア").map((f) => f._id)).toEqual([
      "f3",
    ]);
    expect(filterFolders(FOLDERS, "")).toHaveLength(3);
  });
});

describe("hasFolderNamed", () => {
  test("compares whole names ignoring case and outer spaces", () => {
    expect(hasFolderNamed(FOLDERS, "  moodboard ")).toBe(true);
    expect(hasFolderNamed(FOLDERS, "Mood")).toBe(false);
  });

  test("a folder being renamed does not clash with its own name", () => {
    expect(hasFolderNamed(FOLDERS, "MOODBOARD", "f2")).toBe(false);
    expect(hasFolderNamed(FOLDERS, "Reading list", "f2")).toBe(true);
  });
});

describe("decodeFolderSegment", () => {
  test("decodes escapes and keeps a mangled one as typed", () => {
    expect(decodeFolderSegment("a%20b")).toBe("a b");
    expect(decodeFolderSegment("%E0")).toBe("%E0");
  });
});

describe("smart folder searches", () => {
  test("save the chips, types, tag and view on screen", () => {
    expect(
      buildSmartFolderQuery({
        terms: "#design notes",
        types: ["link"],
        tag: "UI",
        view: "favorites",
      })
    ).toBe("is:fav type:link tag:ui tag:design notes");
    expect(buildSmartFolderQuery({ terms: "", view: "archive" })).toBe(
      "is:archived"
    );
  });

  test("a manual folder is saved as folder:, a smart one's search joins in", () => {
    expect(
      buildSmartFolderQuery({
        terms: "type:link",
        folder: { kind: "manual", name: "Reading list" },
      })
    ).toBe('folder:"Reading list" type:link');
    expect(
      buildSmartFolderQuery({
        terms: "type:link",
        folder: { kind: "smart", name: "Design", query: "tag:design" },
      })
    ).toBe("tag:design type:link");
  });

  test("nothing to save: Trash, an empty search, an unchanged smart folder", () => {
    expect(buildSmartFolderQuery({ terms: "notes", view: "trash" })).toBeNull();
    expect(buildSmartFolderQuery({ terms: "  " })).toBeNull();
    expect(
      buildSmartFolderQuery({
        terms: "",
        folder: { kind: "smart", name: "Design", query: "tag:design" },
      })
    ).toBeNull();
    expect(
      buildSmartFolderQuery({
        terms: "type:image",
        folder: { kind: "smart", name: "Links", query: "type:link" },
      })
    ).toBeNull();
  });

  test("a name reads like the search", () => {
    expect(
      suggestSmartFolderName('tag:design type:link site:github.com "a b" x')
    ).toBe("Design · Links · github.com · “a b” · x");
    expect(suggestSmartFolderName("is:fav")).toBe("Favorites");
    expect(suggestSmartFolderName("price:>20 price:<100 type:link")).toBe(
      "Price over 20 · Price under 100 · Links"
    );
    expect(Array.from(suggestSmartFolderName("a".repeat(400)))).toHaveLength(
      300
    );
  });

  test("manualFolders leaves out smart folders", () => {
    expect(
      manualFolders([
        { kind: "manual", name: "A" },
        { kind: "smart", name: "B" },
      ])
    ).toEqual([{ kind: "manual", name: "A" }]);
  });
});
