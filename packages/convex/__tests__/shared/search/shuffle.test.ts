import { describe, expect, test } from "bun:test";
import {
  isShuffleSeed,
  MAX_SHUFFLE_SEED,
  parseShuffleSeed,
  shuffleBySeed,
  shuffleStart,
} from "../../../shared/search/shuffle";

const ids = Array.from({ length: 50 }, (_, index) => `card_${index}`);
const byId = (id: string) => id;

describe("shuffle seeds", () => {
  test.each([
    ["0", 0],
    ["42", 42],
    [String(MAX_SHUFFLE_SEED), MAX_SHUFFLE_SEED],
    [String(MAX_SHUFFLE_SEED + 1), undefined],
    ["-1", undefined],
    ["1.5", undefined],
    ["abc", undefined],
    ["", undefined],
    [null, undefined],
  ] as [string | null, number | undefined][])(
    "parses %p as %p",
    (text: string | null, seed: number | undefined) => {
      expect(parseShuffleSeed(text)).toBe(seed);
    }
  );

  test("only whole numbers in range are seeds", () => {
    expect(isShuffleSeed(7)).toBe(true);
    expect(isShuffleSeed(7.5)).toBe(false);
    expect(isShuffleSeed(-1)).toBe(false);
    expect(isShuffleSeed(Number.NaN)).toBe(false);
  });

  test("start points fall in [0, 1) and differ by seed", () => {
    const starts = [0, 1, 2, MAX_SHUFFLE_SEED].map(shuffleStart);
    for (const start of starts) {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start).toBeLessThan(1);
    }
    expect(new Set(starts).size).toBe(starts.length);
  });
});

describe("shuffleBySeed", () => {
  test("is the same for a seed and different for another", () => {
    const once = shuffleBySeed(ids, 3, byId);
    expect(shuffleBySeed([...ids].reverse(), 3, byId)).toEqual(once);
    expect(new Set(once)).toEqual(new Set(ids));
    expect(shuffleBySeed(ids, 4, byId)).not.toEqual(once);
    expect(once).not.toEqual(ids);
  });

  test("a new item moves nothing else", () => {
    const before = shuffleBySeed(ids, 11, byId);
    const after = shuffleBySeed([...ids, "card_new"], 11, byId).filter(
      (id) => id !== "card_new"
    );
    expect(after).toEqual(before);
  });
});
