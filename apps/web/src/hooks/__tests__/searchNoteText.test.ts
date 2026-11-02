import { describe, expect, test } from "bun:test";
import { searchHasFilters, searchNoteText } from "../useNoResultsHelp";

describe("a search's words as a note", () => {
  test("keeps the words of a plain search", () => {
    expect(searchNoteText("  call the dentist  ", false)).toBe(
      "call the dentist"
    );
    expect(searchNoteText("meeting at 10:30", false)).toBe("meeting at 10:30");
  });

  test("offers nothing for filters or search syntax", () => {
    expect(searchNoteText("dentist", true)).toBeNull();
    expect(searchNoteText("", false)).toBeNull();
    for (const query of [
      "kestrel -heron",
      "#work notes",
      "type:image cats",
      "(cats OR dogs)",
      "cats OR dogs",
    ]) {
      expect(searchNoteText(query, false)).toBeNull();
    }
  });
});

describe("what counts as a filter", () => {
  const words = {
    filterTags: [],
    hexFilters: [],
    hueFilters: [],
    qualifierChips: [],
    showFavoritesOnly: false,
    styleFilters: [],
  };

  test("words alone are not filtered", () => {
    expect(searchHasFilters(words)).toBe(false);
  });

  test("the favorites filter counts, since a new note isn't a favorite", () => {
    expect(searchHasFilters({ ...words, showFavoritesOnly: true })).toBe(true);
  });

  test("a tag, type, date, color, style or qualifier counts", () => {
    for (const search of [
      { ...words, tagFilter: "work" },
      { ...words, filterTags: ["image"] },
      { ...words, timeFilter: { kind: "today" } },
      { ...words, hexFilters: ["#ff0000"] },
      { ...words, hueFilters: ["red"] },
      { ...words, styleFilters: ["minimal"] },
      { ...words, qualifierChips: ["is:todo"] },
    ]) {
      expect(searchHasFilters(search)).toBe(true);
    }
  });
});
