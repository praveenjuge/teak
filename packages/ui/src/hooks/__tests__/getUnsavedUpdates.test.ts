import { describe, expect, test } from "bun:test";
import { getUnsavedUpdates } from "../useCardModal";

describe("getUnsavedUpdates", () => {
  test("lists an edit that differs from the card", () => {
    expect(getUnsavedUpdates({ notes: "old" }, { notes: "new" }, {})).toEqual([
      { field: "notes", value: "new" },
    ]);
  });

  test("skips an edit back to what the card already has", () => {
    expect(getUnsavedUpdates({ notes: "same" }, { notes: "same" }, {})).toEqual(
      []
    );
    // Clearing a field the card never had is no change either.
    expect(getUnsavedUpdates({}, { notes: "" }, {})).toEqual([]);
  });

  test("doesn't send a value again while its save is on its way back", () => {
    expect(
      getUnsavedUpdates({ content: "a" }, { content: "ab" }, { content: "ab" })
    ).toEqual([]);
  });

  test("saves an undo to an earlier value once the card has moved on", () => {
    // "abc" was saved and the card shows it; typing back to "ab" must save.
    expect(
      getUnsavedUpdates({ content: "abc" }, { content: "ab" }, {})
    ).toEqual([{ field: "content", value: "ab" }]);
  });

  test("never treats favoriting as a text edit", () => {
    expect(getUnsavedUpdates({}, { isFavorited: true }, {})).toEqual([]);
  });
});
