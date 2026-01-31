import { describe, expect, it } from "bun:test";
import { extractUrlFromContent, resolveTextCardInput } from "./linkDetection";

describe("extractUrlFromContent", () => {
  it("should return empty result for empty content", () => {
    const result = extractUrlFromContent("");
    expect(result).toEqual({ cleanedContent: "" });
  });

  it("should return empty result for whitespace-only content", () => {
    const result = extractUrlFromContent("   ");
    // extractUrlFromContent trims the content
    expect(result).toEqual({ cleanedContent: "" });
  });

  it("should extract URL from URL-only content", () => {
    const result = extractUrlFromContent("https://example.com");
    expect(result).toEqual({
      url: "https://example.com",
      cleanedContent: "https://example.com",
    });
  });

  it("should extract http URL from URL-only content", () => {
    const result = extractUrlFromContent("http://example.com/path");
    expect(result).toEqual({
      url: "http://example.com/path",
      cleanedContent: "http://example.com/path",
    });
  });

  it("should extract URL from inline URL in content", () => {
    const result = extractUrlFromContent(
      "Check out this link: https://example.com"
    );
    expect(result).toEqual({
      url: "https://example.com",
      cleanedContent: "Check out this link: https://example.com",
    });
  });

  it("should extract first URL from content with multiple URLs", () => {
    const result = extractUrlFromContent(
      "Visit https://example.com or http://test.com"
    );
    expect(result).toEqual({
      url: "https://example.com",
      cleanedContent: "Visit https://example.com or http://test.com",
    });
  });

  it("should not extract invalid URLs", () => {
    const result = extractUrlFromContent("htp://invalid-url");
    expect(result).toEqual({
      cleanedContent: "htp://invalid-url",
    });
  });

  it("should not extract URLs without valid protocol", () => {
    const result = extractUrlFromContent("example.com/path");
    expect(result).toEqual({
      cleanedContent: "example.com/path",
    });
  });

  it("should extract URL with query parameters", () => {
    const result = extractUrlFromContent(
      "https://example.com?query=test&param=value"
    );
    expect(result).toEqual({
      url: "https://example.com?query=test&param=value",
      cleanedContent: "https://example.com?query=test&param=value",
    });
  });

  it("should extract URL with fragment", () => {
    const result = extractUrlFromContent("https://example.com#section");
    expect(result).toEqual({
      url: "https://example.com#section",
      cleanedContent: "https://example.com#section",
    });
  });

  it("should extract URL from content with trailing punctuation", () => {
    const result = extractUrlFromContent("Check this: https://example.com.");
    // The regex matches until whitespace, so period is included in URL
    // isValidHttpUrl accepts URLs with trailing dots
    expect(result).toEqual({
      url: "https://example.com.",
      cleanedContent: "Check this: https://example.com.",
    });
  });

  it("should handle URL with port number", () => {
    const result = extractUrlFromContent("https://localhost:3000/path");
    expect(result).toEqual({
      url: "https://localhost:3000/path",
      cleanedContent: "https://localhost:3000/path",
    });
  });

  it("should handle URL with authentication", () => {
    const result = extractUrlFromContent("https://user:pass@example.com");
    expect(result).toEqual({
      url: "https://user:pass@example.com",
      cleanedContent: "https://user:pass@example.com",
    });
  });

  it("should handle URL with IP address", () => {
    const result = extractUrlFromContent("https://192.168.1.1/path");
    expect(result).toEqual({
      url: "https://192.168.1.1/path",
      cleanedContent: "https://192.168.1.1/path",
    });
  });

  it("should handle international domain names", () => {
    const result = extractUrlFromContent("https://müller.de/path");
    expect(result).toEqual({
      url: "https://müller.de/path",
      cleanedContent: "https://müller.de/path",
    });
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
});
