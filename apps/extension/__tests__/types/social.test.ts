// @ts-nocheck
import { describe, expect, test } from "bun:test";

import {
  isInlineSavePermalinkAllowed,
  isPlatformInlineSaveHost,
  isSupportedInlineSaveHost,
} from "../../types/social";

describe("inline save platform rules", () => {
  test("recognizes Hacker News as a supported inline save host", () => {
    expect(isSupportedInlineSaveHost("news.ycombinator.com")).toBe(true);
    expect(isPlatformInlineSaveHost("hackernews", "news.ycombinator.com")).toBe(
      true
    );
  });

  test("does not allow Hacker News subdomains", () => {
    expect(isSupportedInlineSaveHost("meta.news.ycombinator.com")).toBe(false);
    expect(
      isPlatformInlineSaveHost("hackernews", "meta.news.ycombinator.com")
    ).toBe(false);
  });

  test("allows outbound article permalinks on Hacker News pages", () => {
    expect(
      isInlineSavePermalinkAllowed(
        "hackernews",
        "https://news.ycombinator.com/news",
        "https://example.com/story"
      )
    ).toBe(true);
  });

  test("rejects self-post Hacker News permalinks", () => {
    expect(
      isInlineSavePermalinkAllowed(
        "hackernews",
        "https://news.ycombinator.com/news",
        "https://news.ycombinator.com/item?id=47295537"
      )
    ).toBe(false);
  });

  test("keeps same-host validation for X permalinks", () => {
    expect(
      isInlineSavePermalinkAllowed(
        "x",
        "https://x.com/teak/status/123",
        "https://x.com/teak/status/123"
      )
    ).toBe(true);
    expect(
      isInlineSavePermalinkAllowed(
        "x",
        "https://x.com/home",
        "https://example.com/story"
      )
    ).toBe(false);
  });
});
