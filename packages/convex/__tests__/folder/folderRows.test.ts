import { describe, expect, test } from "bun:test";
import type { Doc, Id } from "../../_generated/dataModel";
import { cardFolderRowsMayChange } from "../../folder/folderRows";
import {
  explainInvalidFolderName,
  folderNameKey,
  isFolderColor,
  MAX_FOLDER_NAME_LENGTH,
} from "../../shared/folders";

const card = (overrides: Partial<Doc<"cards">> = {}) =>
  ({
    _id: "card" as Id<"cards">,
    _creationTime: 0,
    userId: "user",
    content: "Card",
    type: "text",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }) as Doc<"cards">;

describe("folder names", () => {
  test("are trimmed, required and capped by characters", () => {
    expect(explainInvalidFolderName("  ")).toBe("Name the folder");
    expect(explainInvalidFolderName("x".repeat(MAX_FOLDER_NAME_LENGTH))).toBe(
      null
    );
    expect(
      explainInvalidFolderName("x".repeat(MAX_FOLDER_NAME_LENGTH + 1))
    ).toContain("at most");
    expect(explainInvalidFolderName("🎨".repeat(MAX_FOLDER_NAME_LENGTH))).toBe(
      null
    );
    expect(explainInvalidFolderName("مجلد")).toBe(null);
  });

  test("compare without case or surrounding space", () => {
    expect(folderNameKey("  Design ")).toBe(folderNameKey("design"));
    expect(folderNameKey("Design")).not.toBe(folderNameKey("Designs"));
  });

  test("colors come from the fixed palette", () => {
    expect(isFolderColor("blue")).toBe(true);
    expect(isFolderColor("#0000ff")).toBe(false);
    expect(isFolderColor(undefined)).toBe(false);
  });
});

describe("cardFolderRowsMayChange", () => {
  const folder = "folder" as Id<"folders">;

  test("ignores edits that cannot move a folder row", () => {
    expect(
      cardFolderRowsMayChange(
        card({ folderIds: [folder] }),
        card({ folderIds: [folder], content: "Edited", notes: "New" })
      )
    ).toBe(false);
    // Favorites are not stored on folder rows.
    expect(cardFolderRowsMayChange(card(), card({ isFavorited: true }))).toBe(
      false
    );
  });

  test("notices membership, Trash, Archive, type and date changes", () => {
    expect(cardFolderRowsMayChange(card(), card({ folderIds: [folder] }))).toBe(
      true
    );
    expect(cardFolderRowsMayChange(card({ folderIds: [folder] }), card())).toBe(
      true
    );
    const inFolder = card({ folderIds: [folder] });
    for (const next of [
      card({ folderIds: [folder], isDeleted: true }),
      card({ folderIds: [folder], isArchived: true }),
      card({ folderIds: [folder], type: "link" }),
      card({ folderIds: [folder], createdAt: 2 }),
    ]) {
      expect(cardFolderRowsMayChange(inFolder, next)).toBe(true);
    }
  });

  test("never reads folder rows for a card in no folder", () => {
    expect(cardFolderRowsMayChange(card(), card({ isDeleted: true }))).toBe(
      false
    );
    expect(cardFolderRowsMayChange(undefined, card())).toBe(false);
    expect(
      cardFolderRowsMayChange(undefined, card({ folderIds: [folder] }))
    ).toBe(true);
  });
});
