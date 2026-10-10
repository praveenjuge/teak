import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const headingLevels = (source: string) =>
  [...source.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));

const SHOWCASE_TAG = "<HomeFeatureShowcase />";
const homepageSource = read("../pages/index.astro");

/** Homepage markup in document order, with the showcase expanded in place. */
const homepage = homepageSource.replace(
  SHOWCASE_TAG,
  read("../components/HomeFeatureShowcase.astro")
);

describe("homepage heading hierarchy", () => {
  test("renders the showcase on the homepage", () => {
    // Without this, the checks below could pass without covering the showcase.
    expect(homepageSource).toContain(SHOWCASE_TAG);
  });

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

  test("the features section is an H2 with its card titles under it", () => {
    const showcase = read("../components/HomeFeatureShowcase.astro");

    expect(headingLevels(showcase)).toEqual([2, 3]);
  });
});
