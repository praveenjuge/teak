import { describe, expect, it } from "bun:test";
import {
  extractUrlFromContent,
  resolveTextCardInput,
} from "../../../shared/utils/linkDetection";
import { loadFixture } from "../loadFixture.test-utils";

const { extract } = loadFixture<{
  extract: { cleanedContent: string; content: string; url: string | null }[];
}>("linkDetection");

describe("extractUrlFromContent", () => {
  it.each(extract)("%#: $content", ({ content, url, cleanedContent }) => {
    expect(extractUrlFromContent(content)).toEqual(
      url === null ? { cleanedContent } : { url, cleanedContent }
    );
  });
});

describe("resolveTextCardInput", () => {
  it("should return text card type when no URL is provided", () => {
    const result = resolveTextCardInput({ content: "Just some text" });
    expect(result).toEqual({
      type: "text",
      content: "Just some text",
    });
  });

  it("should return text card type when URL extraction fails from content", () => {
    const result = resolveTextCardInput({ content: "Just some text" });
    expect(result).toEqual({
      type: "text",
      content: "Just some text",
    });
  });

  it("should return link card type when URL is provided", () => {
    const result = resolveTextCardInput({
      content: "Check this out",
      url: "https://example.com",
    });
    expect(result).toEqual({
      type: "link",
      url: "https://example.com",
      content: "Check this out",
    });
  });

  it("should extract URL from content when url param is null", () => {
    const result = resolveTextCardInput({
      content: "https://example.com",
      url: null,
    });
    expect(result).toEqual({
      type: "link",
      url: "https://example.com",
      content: "https://example.com",
    });
  });

  it("should extract URL from content when url param is undefined", () => {
    const result = resolveTextCardInput({
      content: "Visit https://example.com today",
    });
    expect(result).toEqual({
      type: "link",
      url: "https://example.com",
      content: "Visit https://example.com today",
    });
  });

  it("should prioritize url param over content URL", () => {
    const result = resolveTextCardInput({
      content: "Check https://other.com",
      url: "https://example.com",
    });
    expect(result).toEqual({
      type: "link",
      url: "https://example.com",
      content: "Check https://other.com",
    });
  });

  it("should handle whitespace-only URL", () => {
    const result = resolveTextCardInput({
      content: "Some text",
      url: "   ",
    });
    expect(result).toEqual({
      type: "text",
      content: "Some text",
    });
  });

  it("should handle invalid URL in url param", () => {
    const result = resolveTextCardInput({
      content: "Some text",
      url: "not-a-url",
    });
    expect(result).toEqual({
      type: "text",
      content: "Some text",
    });
  });

  it("should trim whitespace from url param", () => {
    const result = resolveTextCardInput({
      content: "My content",
      url: "  https://example.com  ",
    });
    expect(result).toEqual({
      type: "link",
      url: "https://example.com",
      content: "My content",
    });
  });

  it("should return text type when no valid URL anywhere", () => {
    const result = resolveTextCardInput({
      content: "Just regular text without URLs",
      url: undefined,
    });
    expect(result).toEqual({
      type: "text",
      content: "Just regular text without URLs",
    });
  });

  it("should handle empty content with valid URL param", () => {
    const result = resolveTextCardInput({
      content: "",
      url: "https://example.com",
    });
    expect(result).toEqual({
      type: "link",
      url: "https://example.com",
      content: "",
    });
  });

  it("should handle empty content with URL in content field", () => {
    const result = resolveTextCardInput({
      content: "https://example.com",
      url: undefined,
    });
    expect(result).toEqual({
      type: "link",
      url: "https://example.com",
      content: "https://example.com",
    });
  });

  it("resolves an escaped URL in content to a clean link card", () => {
    expect(
      resolveTextCardInput({
        content: "https://en.wikipedia.org/wiki/Tectona\\_grandis",
      })
    ).toEqual({
      type: "link",
      url: "https://en.wikipedia.org/wiki/Tectona_grandis",
      content: "https://en.wikipedia.org/wiki/Tectona_grandis",
    });
  });

  it("should resolve a Goodreads book URL in content to a link card", () => {
    const url = "https://www.goodreads.com/book/show/2767052-the-hunger-games";
    const result = resolveTextCardInput({ content: url });
    expect(result).toEqual({
      type: "link",
      url,
      content: url,
    });
  });
});
