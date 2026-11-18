import { describe, expect, test } from "bun:test";
import {
  IMAGE_SOURCES,
  PODCAST_SOURCES,
  SCRAPE_ELEMENTS,
  SPOTIFY_SOURCES,
} from "./selectors";

describe("linkMetadata selectors", () => {
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

  test("scrapes the artist Spotify's pages name", () => {
    const selectors = new Set(SCRAPE_ELEMENTS.map((entry) => entry.selector));
    for (const source of SPOTIFY_SOURCES) {
      expect(selectors.has(source.selector)).toBe(true);
    }
  });

  test("scrapes a podcast episode's audio tags and feed links", () => {
    const selectors = new Set(SCRAPE_ELEMENTS.map((entry) => entry.selector));
    for (const source of PODCAST_SOURCES) {
      expect(selectors.has(source.selector)).toBe(true);
    }
  });
});
