// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
  TITLE_SOURCES,
  DESCRIPTION_SOURCES,
  IMAGE_SOURCES,
  SCRAPE_ELEMENTS,
} from "../convex/linkMetadata/selectors";

describe("linkMetadata selectors", () => {
  test("includes expected title/description selectors", () => {
    expect(TITLE_SOURCES[0]?.selector).toBe("meta[property='og:title']");
    expect(DESCRIPTION_SOURCES[0]?.selector).toBe("meta[property='og:description']");
  });

  test("deduplicates scrape elements by selector", () => {
    const selectors = SCRAPE_ELEMENTS.map((entry) => entry.selector);
    const unique = new Set(selectors);
    expect(unique.size).toBe(selectors.length);
  });

  test("includes image sources in scrape elements", () => {
    const selectors = new Set(SCRAPE_ELEMENTS.map((entry) => entry.selector));
    for (const source of IMAGE_SOURCES) {
      expect(selectors.has(source.selector)).toBe(true);
    }
  });
});
