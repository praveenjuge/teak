import { describe, expect, test } from "bun:test";

import { compareCardsBySavedAt, savedAtOf } from "../../../shared/search/sort";

interface Card {
  _creationTime: number;
  createdAt: number;
  id: string;
  savedAt?: number;
}

const order = (cards: Card[], sort: "newest" | "oldest") =>
  [...cards]
    .sort((left, right) => compareCardsBySavedAt(left, right, sort))
    .map((card) => card.id);

describe("compareCardsBySavedAt", () => {
  // First saved long ago, saved again most recently.
  const resaved: Card = {
    id: "resaved",
    _creationTime: 1,
    createdAt: 1000,
    savedAt: 9000,
  };
  const recent: Card = {
    id: "recent",
    _creationTime: 2,
    createdAt: 5000,
    savedAt: 5000,
  };
  const middle: Card = {
    id: "middle",
    _creationTime: 3,
    createdAt: 3000,
    savedAt: 3000,
  };

  test("puts a card saved again first in Newest and last in Oldest", () => {
    expect(order([middle, resaved, recent], "newest")).toEqual([
      "resaved",
      "recent",
      "middle",
    ]);
    expect(order([middle, resaved, recent], "oldest")).toEqual([
      "middle",
      "recent",
      "resaved",
    ]);
  });

  test("orders a card without savedAt by its createdAt", () => {
    const legacy: Card = { id: "legacy", _creationTime: 4, createdAt: 4000 };
    expect(order([middle, legacy, recent], "newest")).toEqual([
      "recent",
      "legacy",
      "middle",
    ]);
    expect(order([middle, legacy, recent], "oldest")).toEqual([
      "middle",
      "legacy",
      "recent",
    ]);
  });

  test("breaks a tie on the saved date by _creationTime", () => {
    const first: Card = {
      id: "first",
      _creationTime: 10,
      createdAt: 1,
      savedAt: 7000,
    };
    const second: Card = { id: "second", _creationTime: 20, createdAt: 7000 };
    expect(order([first, second], "newest")).toEqual(["second", "first"]);
    expect(order([second, first], "oldest")).toEqual(["first", "second"]);
  });
});

describe("savedAtOf", () => {
  test("reads savedAt, or createdAt on a card from before it", () => {
    expect(savedAtOf({ createdAt: 1000, savedAt: 9000 })).toBe(9000);
    expect(savedAtOf({ createdAt: 1000 })).toBe(1000);
  });
});
