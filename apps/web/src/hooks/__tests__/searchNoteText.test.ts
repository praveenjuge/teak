import { describe, expect, test } from "bun:test";
import { searchNoteText } from "../useNoResultsHelp";

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
