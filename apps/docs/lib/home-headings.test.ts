import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const headingLevels = (source: string) =>
  [...source.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));

/** Homepage markup in document order, with the showcase expanded in place. */
const homepage = read("../pages/index.astro").replace(
  "<HomeFeatureShowcase />",
  read("../components/HomeFeatureShowcase.astro"),
);

describe("homepage heading hierarchy", () => {
  test("has one H1 and starts with it", () => {
    const levels = headingLevels(homepage);

    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
  });

  test("never skips a level going deeper", () => {
    const levels = headingLevels(homepage);

    levels.forEach((level, index) => {
      if (index > 0) {
        expect(level).toBeLessThanOrEqual(levels[index - 1] + 1);
      }
    });
  });

  test("showcase story titles are section headings under the H1", () => {
    const showcase = read("../components/HomeFeatureShowcase.astro");

    expect(headingLevels(showcase)).toEqual([2]);
  });
});
