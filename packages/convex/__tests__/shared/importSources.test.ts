import { describe, expect, test } from "bun:test";
import {
  describeImportFailure,
  IMPORT_FAILURE,
  IMPORT_MODES,
  IMPORT_PICKER_MODES,
  importFileMatches,
  isImportMode,
} from "../../shared/importSources";

describe("IMPORT_PICKER_MODES", () => {
  test("offers general sources first, the services next and Teak archive last", () => {
    expect(IMPORT_PICKER_MODES).toEqual([
      "bookmarks",
      "csv",
      "links",
      "pocket",
      "raindrop",
      "instapaper",
      "readwise",
      "omnivore",
      "linkwarden",
      "mymind",
      "archive",
    ]);
  });

  test("hides OneTab, which stays a valid mode for jobs started with it", () => {
    expect(IMPORT_PICKER_MODES).not.toContain("onetab");
    expect(isImportMode("onetab")).toBe(true);
    expect(
      IMPORT_MODES.filter((mode) => !IMPORT_PICKER_MODES.includes(mode))
    ).toEqual(["onetab"]);
  });

  test("CSV takes .csv files and text files of links take .txt", () => {
    expect(importFileMatches("csv", "Links.CSV")).toBe(true);
    expect(importFileMatches("csv", "links.txt")).toBe(false);
    expect(importFileMatches("links", "tabs.txt")).toBe(true);
  });
});

describe("describeImportFailure", () => {
  test("a CSV without a url column says how to fix it", () => {
    expect(
      describeImportFailure("csv", IMPORT_FAILURE.MISSING_URL_COLUMN)
    ).toBe(
      "This CSV has no url column. Add a header row with a url (or link) column."
    );
  });

  test("a CSV that isn't one, and a text file with no links", () => {
    expect(describeImportFailure("csv", IMPORT_FAILURE.INVALID_SOURCE)).toBe(
      "This doesn't look like a CSV export. Check the source and choose the file it describes."
    );
    expect(describeImportFailure("links", IMPORT_FAILURE.INVALID_SOURCE)).toBe(
      "This file has no links. Put one link on each line."
    );
    expect(
      describeImportFailure("onetab", IMPORT_FAILURE.INVALID_SOURCE)
    ).toContain("OneTab export");
  });
});
