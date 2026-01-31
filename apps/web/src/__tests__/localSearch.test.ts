import { describe, expect, it } from "bun:test";

import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { buildSearchableText, filterLocalCards, tokenizeSearchQuery } from "../lib/localSearch";

type CardOverrides = Partial<Omit<Doc<"cards">, "_id">> & {
  _id?: Id<"cards"> | string;
};

const makeId = (value: string) => value as Id<"cards">;

const makeCard = (overrides: CardOverrides): Doc<"cards"> =>
({
  _id: overrides._id ? (overrides._id as Id<"cards">) : makeId("card"),
  _creationTime: 0,
  userId: "user",
  content: "",
  type: "text",
  metadata: {} as any,
  fileMetadata: {} as any,
  processingStatus: {} as any,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
} as Doc<"cards">);

describe("localSearch helpers", () => {
  it("tokenizes and normalizes search terms", () => {
    expect(tokenizeSearchQuery("  Foo   BAR ")).toEqual(["foo", "bar"]);
  });

  it("builds searchable text from core fields and tags", () => {
    const card = makeCard({
      content: "Hello",
      notes: "World",
      tags: ["Alpha"],
      aiTags: ["Beta"],
    });

    const text = buildSearchableText(card);
    expect(text).toContain("hello");
    expect(text).toContain("world");
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
  });

  it("filters by search terms across fields", () => {
    const cards = [
      makeCard({
        _id: "1",
        content: "Alpha beta",
        createdAt: 1,
        updatedAt: 1,
      }),
      makeCard({
        _id: "2",
        notes: "Gamma",
        createdAt: 2,
        updatedAt: 2,
      }),
    ];

    const results = filterLocalCards(cards, { searchTerms: "beta" });
    expect(results.map((card) => card._id)).toEqual(["1"]);
  });

  it("respects type, favorites, and trash filters", () => {
    const cards = [
      makeCard({
        _id: "1",
        type: "link",
        isFavorited: true,
        createdAt: 2,
        updatedAt: 2,
      }),
      makeCard({
        _id: "2",
        type: "text",
        isFavorited: true,
        createdAt: 1,
        updatedAt: 1,
      }),
      makeCard({
        _id: "3",
        type: "link",
        isDeleted: true,
        createdAt: 3,
        updatedAt: 3,
      }),
    ];

    const results = filterLocalCards(cards, {
      types: ["link"],
      favoritesOnly: true,
      showTrashOnly: false,
    });
    expect(results.map((card) => card._id)).toEqual(["1"]);

    const trashResults = filterLocalCards(cards, {
      showTrashOnly: true,
    });
    expect(trashResults.map((card) => card._id)).toEqual(["3"]);
  });

  it("sorts results by createdAt descending", () => {
    const cards = [
      makeCard({ _id: "1", content: "Alpha", createdAt: 10, updatedAt: 10 }),
      makeCard({ _id: "2", content: "Alpha", createdAt: 30, updatedAt: 30 }),
      makeCard({ _id: "3", content: "Alpha", createdAt: 20, updatedAt: 20 }),
    ];

    const results = filterLocalCards(cards, { searchTerms: "alpha" });
    expect(results.map((card) => card._id)).toEqual(["2", "3", "1"]);
  });
});
