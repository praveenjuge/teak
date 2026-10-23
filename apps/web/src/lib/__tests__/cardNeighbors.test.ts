import { describe, expect, test } from "bun:test";
import {
  getAdjacentCardIds,
  getAdjacentCardIdsKeepingPlace,
} from "../cardNeighbors";

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

describe("getAdjacentCardIdsKeepingPlace", () => {
  test("uses the current list while it holds the open card", () => {
    expect(
      getAdjacentCardIdsKeepingPlace(["a", "b", "c"], ["x", "b", "y"], "b")
    ).toEqual({ previous: "a", next: "c" });
  });

  test("keeps the open card's place after it leaves the view", () => {
    expect(
      getAdjacentCardIdsKeepingPlace(["a", "c"], ["a", "b", "c"], "b")
    ).toEqual({ previous: "a", next: "c" });
  });

  test("skips neighbours that left the view too", () => {
    expect(
      getAdjacentCardIdsKeepingPlace(["a", "e"], ["a", "b", "c", "d", "e"], "c")
    ).toEqual({ previous: "a", next: "e" });
    expect(getAdjacentCardIdsKeepingPlace([], ["a", "b"], "b")).toEqual({
      previous: undefined,
      next: undefined,
    });
  });

  test("offers neither for a card neither list has", () => {
    expect(getAdjacentCardIdsKeepingPlace(["a"], ["a"], "z")).toEqual({});
    expect(getAdjacentCardIdsKeepingPlace(["a"], undefined, "z")).toEqual({});
  });
});
