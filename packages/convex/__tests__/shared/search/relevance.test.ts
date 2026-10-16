import { describe, expect, test } from "bun:test";
import {
  buildRelevanceCardText,
  currentRelevanceScores,
  orderByRelevance,
  relevanceSearchKey,
} from "../../../shared/search/relevance";

const ids = (cards: { _id: string }[]) => cards.map((card) => card._id);

describe("orderByRelevance", () => {
  const cards = ["a", "b", "c", "d", "e"].map((_id) => ({ _id }));

  test("scored cards first, highest first, the rest in search order", () => {
    const scores = new Map([
      ["d", 3],
      ["b", 1],
      ["e", 3],
    ]);
    expect(ids(orderByRelevance(cards, scores))).toEqual([
      "d",
      "e",
      "b",
      "a",
      "c",
    ]);
  });

  test("no scores keep the search order", () => {
    expect(ids(orderByRelevance(cards, new Map()))).toEqual(ids(cards));
  });
});

test("only scores of unedited cards count", () => {
  const current = currentRelevanceScores(
    [
      { cardId: "a", score: 3, cardUpdatedAt: 10 },
      { cardId: "b", score: 2, cardUpdatedAt: 10 },
      { cardId: "gone", score: 1, cardUpdatedAt: 10 },
    ],
    [
      { _id: "a", updatedAt: 10 },
      { _id: "b", updatedAt: 11 },
    ]
  );
  expect([...current]).toEqual([["a", 3]]);
});

test("a card's text holds what Clef needs and stays short", () => {
  const text = buildRelevanceCardText({
    _id: "a",
    type: "link",
    updatedAt: 1,
    urlHost: "example.com",
    metadata: {
      linkPreview: {
        status: "success",
        title: "Weeknight lentil soup",
        description: "Ingredients and steps.",
      },
    },
    aiSummary: "A quick soup.",
    tags: ["soup"],
    aiTags: ["lentils", "dinner"],
    content: "x".repeat(5000),
  });
  expect(text).toContain("Type: link");
  expect(text).toContain("Title: Weeknight lentil soup");
  expect(text).toContain("Site: example.com");
  expect(text).toContain("Tags: soup, lentils, dinner");
  expect(text.length).toBeLessThanOrEqual(600);
});

test("the cache key hides the search text and changes with it", async () => {
  const key = await relevanceSearchKey("lentil soup");
  expect(key).toMatch(/^[0-9a-f]{64}$/u);
  expect(key).not.toContain("lentil");
  expect(await relevanceSearchKey("bread")).not.toBe(key);
});
