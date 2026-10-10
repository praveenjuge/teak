import { describe, expect, test } from "bun:test";
import { buildCardEdit, normalizeTag } from "../../lib/card-edit";

const card = {
  aiTags: ["Design", "Color"],
  content: "Original",
  notes: "Old notes",
  tags: ["keep"],
  type: "text" as const,
};

describe("card edits", () => {
  test("an untouched form saves nothing", () => {
    expect(
      buildCardEdit(card, {
        aiTags: ["Design", "Color"],
        content: "Original",
        notes: "Old notes",
        tags: ["keep"],
      })
    ).toEqual({ changes: [], hasChanges: false });
  });

  test("turns each edit into the field update the web makes", () => {
    const { changes } = buildCardEdit(card, {
      aiTags: ["Design"],
      content: "Rewritten",
      notes: "  ",
      tags: ["keep", "new"],
    });
    expect(changes).toEqual([
      { field: "content", value: "Rewritten" },
      { field: "notes", value: null },
      { field: "tags", value: ["keep", "new"] },
      { field: "removeAiTag", tagToRemove: "Color" },
    ]);
  });

  test("leaves content alone for types that can't be rewritten", () => {
    const { changes } = buildCardEdit(
      { ...card, type: "link" as const },
      { aiTags: card.aiTags, notes: "Old notes", tags: ["keep"] }
    );
    expect(changes).toEqual([]);
  });

  test("tags are trimmed and lowercase", () => {
    expect(normalizeTag("  Inspiration ")).toBe("inspiration");
  });
});
