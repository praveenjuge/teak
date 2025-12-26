import { describe, expect, test } from "bun:test";
import {
  extractUrlFromContent,
  resolveTextCardInput,
} from "../convex/shared/utils/linkDetection";

describe("shared/utils/linkDetection.ts", () => {
  test("extractUrlFromContent detects full URL content", () => {
    const result = extractUrlFromContent("  https://example.com/test  ");
    expect(result.url).toBe("https://example.com/test");
    expect(result.cleanedContent).toBe("https://example.com/test");
  });

  test("extractUrlFromContent detects inline URL", () => {
    const result = extractUrlFromContent(
      "Check this https://example.com/page please"
    );
    expect(result.url).toBe("https://example.com/page");
    expect(result.cleanedContent).toBe(
      "Check this https://example.com/page please"
    );
  });

  test("extractUrlFromContent ignores non-url content", () => {
    const result = extractUrlFromContent("hello world");
    expect(result.url).toBeUndefined();
    expect(result.cleanedContent).toBe("hello world");
  });

  test("resolveTextCardInput returns link card for URL content", () => {
    const result = resolveTextCardInput({ content: "  https://example.com " });
    expect(result.type).toBe("link");
    expect(result.url).toBe("https://example.com");
    expect(result.content).toBe("https://example.com");
  });

  test("resolveTextCardInput prefers explicit url", () => {
    const result = resolveTextCardInput({
      content: "Some notes about a link",
      url: "https://example.com",
    });
    expect(result.type).toBe("link");
    expect(result.url).toBe("https://example.com");
    expect(result.content).toBe("Some notes about a link");
  });
});
