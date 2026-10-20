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
    expect(getUnsavedUpdates({}, { notes: "" }, {})).toEqual([]);
  });

  test("doesn't send a value again while its save is on its way back", () => {
    expect(
      getUnsavedUpdates({ content: "a" }, { content: "ab" }, { content: "ab" })
    ).toEqual([]);
  });

  test("saves an undo to an earlier value once the card has moved on", () => {
    expect(
      getUnsavedUpdates({ content: "abc" }, { content: "ab" }, {})
    ).toEqual([{ field: "content", value: "ab" }]);
  });

  test("never treats favoriting as a text edit", () => {
    expect(getUnsavedUpdates({}, { isFavorited: true }, {})).toEqual([]);
  });

  test("never saves a link title someone has cleared", () => {
    const card = { metadataTitle: "My name for it" };
    expect(getUnsavedUpdates(card, { metadataTitle: "" }, {})).toEqual([]);
    expect(getUnsavedUpdates(card, { metadataTitle: "   " }, {})).toEqual([]);
    expect(
      getUnsavedUpdates(card, { metadataTitle: "A new name" }, {})
    ).toEqual([{ field: "metadataTitle", value: "A new name" }]);
  });
});
