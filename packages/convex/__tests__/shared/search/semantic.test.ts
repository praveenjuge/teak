import { describe, expect, test } from "bun:test";
import { parseSearchQuery } from "../../../shared/search/qualifiers";
import {
  fuseRankings,
  isSearchMode,
  SEMANTIC_MIN_SCORE,
  semanticQueryText,
} from "../../../shared/search/semantic";

const text = (query: string) => semanticQueryText(parseSearchQuery(query));

describe("semanticQueryText", () => {
  test("keeps the free words and phrases, lowercased", () => {
    expect(text('Cozy   Reading "Window Seat" tag:home')).toBe(
      "cozy reading window seat"
    );
  });

  test("is empty for qualifier-only, color-only and one-letter searches", () => {
    expect(text("tag:design type:link is:fav site:github.com")).toBe("");
    expect(text('folder:"Reading list" #ui')).toBe("");
    expect(text("#ff0000 #fff")).toBe("");
    expect(text("a")).toBe("");
    expect(text("")).toBe("");
  });

  test("searches a color's neighbors by meaning without the color", () => {
    expect(text("red #ff0000 poster")).toBe("red poster");
    expect(text("bed cafe")).toBe("bed cafe");
  });

  test("cuts very long searches to the worker's limit", () => {
    expect(text("word ".repeat(400))).toHaveLength(499);
  });
});

describe("fuseRankings", () => {
  const strong = SEMANTIC_MIN_SCORE + 0.1;
  const weak = SEMANTIC_MIN_SCORE - 0.1;

  test("keyword mode keeps the keyword order and ignores meaning", () => {
    expect(
      fuseRankings(["a", "b"], [{ cardId: "c", score: 0.9 }], {
        mode: "keyword",
        limit: 10,
      })
    ).toEqual(["a", "b"]);
  });

  test("hybrid adds strong meaning matches and ranks cards on both sides first", () => {
    expect(
      fuseRankings(
        ["a", "b", "c"],
        [
          { cardId: "x", score: strong },
          { cardId: "c", score: strong + 0.05 },
        ],
        { mode: "hybrid", limit: 10 }
      )
    ).toEqual(["c", "a", "b", "x"]);
  });

  test("hybrid drops weak meaning-only matches but counts weak keyword ones", () => {
    expect(
      fuseRankings(
        ["a", "b"],
        [
          { cardId: "b", score: weak },
          { cardId: "noise", score: weak },
        ],
        { mode: "hybrid", limit: 10 }
      )
    ).toEqual(["b", "a"]);
  });

  test("semantic mode keeps strong meaning matches in score order only", () => {
    expect(
      fuseRankings(
        ["a", "b"],
        [
          { cardId: "b", score: weak },
          { cardId: "y", score: strong },
          { cardId: "x", score: strong + 0.2 },
        ],
        { mode: "semantic", limit: 10 }
      )
    ).toEqual(["x", "y"]);
  });

  test("ties keep the keyword order, then the meaning order", () => {
    expect(
      fuseRankings(
        ["a"],
        [
          { cardId: "x", score: strong },
          { cardId: "y", score: strong },
        ],
        { mode: "hybrid", limit: 10 }
      )
    ).toEqual(["a", "x", "y"]);
  });

  test("caps the set and ignores repeated ids", () => {
    expect(
      fuseRankings(
        ["a", "a", "b"],
        [
          { cardId: "x", score: strong },
          { cardId: "x", score: strong },
        ],
        { mode: "hybrid", limit: 2 }
      )
    ).toEqual(["a", "x"]);
  });
});

test("isSearchMode accepts only the three modes", () => {
  expect(["hybrid", "keyword", "semantic"].every(isSearchMode)).toBe(true);
  expect(isSearchMode("bogus")).toBe(false);
  expect(isSearchMode(undefined)).toBe(false);
});
