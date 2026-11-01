import { describe, expect, test } from "bun:test";
import {
  buildSearchVocabulary,
  suggestSearchSpelling,
  typoDistance,
} from "../didYouMean";

const vocabulary = buildSearchVocabulary([
  "kestrel",
  "Kestrel nesting boxes",
  "design systems",
  "verify-navx",
  "heron",
  "art",
]);

describe("suggestSearchSpelling", () => {
  test("corrects a typo to a word from the person's own cards", () => {
    expect(suggestSearchSpelling("kestral", vocabulary)).toBe("kestrel");
    expect(suggestSearchSpelling("desing", vocabulary)).toBe("design");
  });

  test("keeps known words, qualifiers and exclusions as typed", () => {
    expect(suggestSearchSpelling("kestral tag:Art -heron", vocabulary)).toBe(
      "kestrel tag:Art -heron"
    );
    expect(suggestSearchSpelling("kestrel heron", vocabulary)).toBeNull();
  });

  test("offers nothing for a word far from every known one", () => {
    expect(suggestSearchSpelling("zebra", vocabulary)).toBeNull();
    expect(suggestSearchSpelling("", vocabulary)).toBeNull();
    expect(suggestSearchSpelling("kestral", new Map())).toBeNull();
  });

  test("short words allow one typo, longer ones two", () => {
    expect(suggestSearchSpelling("hron", vocabulary)).toBe("heron");
    expect(suggestSearchSpelling("hrnx", vocabulary)).toBeNull();
    expect(suggestSearchSpelling("heorn", vocabulary)).toBe("heron");
    expect(suggestSearchSpelling("verfy-nvax", vocabulary)).toBe("verify-navx");
  });

  test("prefers the word the person uses most", () => {
    const counted = buildSearchVocabulary(["cart", "card card card"]);
    expect(suggestSearchSpelling("carx", counted)).toBe("card");
  });
});

describe("typoDistance", () => {
  test("counts a swap of neighbours as one edit", () => {
    expect(typoDistance("kestral", "kestrel", 2)).toBe(1);
    expect(typoDistance("ab", "ba", 2)).toBe(1);
    expect(typoDistance("abc", "xyz", 1)).toBe(2);
  });
});
