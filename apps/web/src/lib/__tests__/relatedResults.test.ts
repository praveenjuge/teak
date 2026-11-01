import { describe, expect, test } from "bun:test";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { relatedOnlyCardIds } from "../relatedResults";

const card = (
  id: string,
  content: string,
  extra: Partial<Doc<"cards">> & { matchedByMeaning?: true } = {}
) =>
  ({
    _creationTime: 0,
    _id: id as Id<"cards">,
    content,
    createdAt: 0,
    type: "text",
    updatedAt: 0,
    userId: "user",
    ...extra,
  }) as Doc<"cards">;

const related = (cards: Doc<"cards">[], searchTerms: string) =>
  [...relatedOnlyCardIds(cards, { searchTerms, textMatchedByServer: true })]
    .sort()
    .join(",");

describe("relatedOnlyCardIds", () => {
  test("a meaning match without the words is related", () => {
    expect(
      related(
        [card("armchair", "Armchair by a window", { matchedByMeaning: true })],
        "reading nook"
      )
    ).toBe("armchair");
  });

  test("a meaning match that holds every word is a word match", () => {
    expect(
      related(
        [
          card("nook", "A reading nook by the stairs", {
            matchedByMeaning: true,
          }),
        ],
        "reading nook"
      )
    ).toBe("");
  });

  test("a meaning match holding only some of the words stays related", () => {
    expect(
      related(
        [card("chair", "A reading chair", { matchedByMeaning: true })],
        "reading nook"
      )
    ).toBe("chair");
  });

  test("an unmarked card is never related", () => {
    expect(related([card("plain", "Armchair")], "reading nook")).toBe("");
  });

  test("a marked card whose text the list leaves out counts as a word match", () => {
    expect(
      related(
        [
          card("pdf", "Invoice", {
            hasExtractedText: true,
            matchedByMeaning: true,
            type: "document",
          }),
        ],
        "net thirty"
      )
    ).toBe("");
  });
});
