import { describe, expect, test } from "bun:test";
import { getAdjacentCardIds } from "../cardNeighbors";

describe("getAdjacentCardIds", () => {
  const ids = ["a", "b", "c"];

  test("finds the cards on either side", () => {
    expect(getAdjacentCardIds(ids, "b")).toEqual({ previous: "a", next: "c" });
  });

  test("has no previous on the first card and no next on the last", () => {
    expect(getAdjacentCardIds(ids, "a")).toEqual({
      previous: undefined,
      next: "b",
    });
    expect(getAdjacentCardIds(ids, "c")).toEqual({
      previous: "b",
      next: undefined,
    });
  });

  test("offers neither for a card the grid doesn't list", () => {
    expect(getAdjacentCardIds(ids, "z")).toEqual({});
    expect(getAdjacentCardIds(ids, null)).toEqual({});
    expect(getAdjacentCardIds(["only"], "only")).toEqual({
      previous: undefined,
      next: undefined,
    });
  });
});
