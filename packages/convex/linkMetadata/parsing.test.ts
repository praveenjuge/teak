import { describe, it, expect } from "bun:test";
import {
  toSelectorMap,
  findAttributeValue,
  getSelectorValue,
  firstFromSources,
  sanitizeText,
  sanitizeUrl,
  sanitizeImageUrl,
} from "./parsing";

// Mock types for testing
type MockScrapeResultItem = {
  text?: string;
  html?: string;
  attributes?: Array<{ name: string; value: string }>;
};

type MockSelectorResult = {
  selector: string;
  results: MockScrapeResultItem[];
};

const createMockItem = (
  text?: string,
  attributes?: Record<string, string>
): MockScrapeResultItem => ({
  text,
  attributes: attributes
    ? Object.entries(attributes).map(([name, value]) => ({ name, value }))
    : undefined,
});

const createMockResults = (
  selector: string,
  items: MockScrapeResultItem[]
): MockSelectorResult => ({ selector, results: items });

describe("toSelectorMap", () => {
  it("should return empty map for undefined input", () => {
    const map = toSelectorMap(undefined);
    expect(map.size).toBe(0);
  });

  it("should return empty map for empty array", () => {
    const map = toSelectorMap([]);
    expect(map.size).toBe(0);
  });

  it("should create map from selector results", () => {
    const results: MockSelectorResult[] = [
      createMockResults("selector1", [createMockItem("text1")]),
      createMockResults("selector2", [createMockItem("text2")]),
    ];
    const map = toSelectorMap(results as any);
    expect(map.size).toBe(2);
    expect(map.get("selector1")).toHaveLength(1);
    expect(map.get("selector2")).toHaveLength(1);
  });

  it("should handle empty results array for a selector", () => {
    const results: MockSelectorResult[] = [
      createMockResults("selector1", []),
    ];
    const map = toSelectorMap(results as any);
    expect(map.get("selector1")).toEqual([]);
  });

  it("should handle multiple results per selector", () => {
    const results: MockSelectorResult[] = [
      createMockResults("selector1", [
        createMockItem("text1"),
        createMockItem("text2"),
      ]),
    ];
    const map = toSelectorMap(results as any);
    expect(map.get("selector1")).toHaveLength(2);
  });
});

describe("findAttributeValue", () => {
  it("should return undefined for undefined item", () => {
    expect(findAttributeValue(undefined, "href")).toBeUndefined();
  });

  it("should return undefined for item without attributes", () => {
    const item = createMockItem("text");
    expect(findAttributeValue(item, "href")).toBeUndefined();
  });

  it("should find attribute by name", () => {
    const item = createMockItem("text", { href: "https://example.com" });
    expect(findAttributeValue(item, "href")).toBe("https://example.com");
  });

  it("should be case insensitive for attribute name", () => {
    const item = createMockItem("text", { HREF: "https://example.com" });
    expect(findAttributeValue(item, "href")).toBe("https://example.com");
    expect(findAttributeValue(item, "HREF")).toBe("https://example.com");
    expect(findAttributeValue(item, "HrEf")).toBe("https://example.com");
  });

  it("should return undefined for non-existent attribute", () => {
    const item = createMockItem("text", { src: "image.jpg" });
    expect(findAttributeValue(item, "href")).toBeUndefined();
  });

  it("should trim attribute value", () => {
    const item = createMockItem("text", { href: "  https://example.com  " });
    expect(findAttributeValue(item, "href")).toBe("https://example.com");
  });

  it("should return undefined for empty attribute value", () => {
    const item = createMockItem("text", { href: "" });
    const result = findAttributeValue(item, "href");
    // findAttributeValue returns undefined for empty attribute values after trimming
    expect(result).toBeUndefined();
  });

  it("should handle attributes with undefined name", () => {
    const item = {
      text: "text",
      attributes: [{ value: "value" }],
    };
    expect(findAttributeValue(item as any, "href")).toBeUndefined();
  });
});

describe("getSelectorValue", () => {
  it("should return undefined for empty map", () => {
    const map = toSelectorMap([]);
    const source = { selector: "test", attribute: "text" as const };
    expect(getSelectorValue(map, source)).toBeUndefined();
  });

  it("should return undefined for non-existent selector", () => {
    const map = toSelectorMap([
      createMockResults("other", [createMockItem("text")]),
    ] as any);
    const source = { selector: "test", attribute: "text" as const };
    expect(getSelectorValue(map, source)).toBeUndefined();
  });

  it("should return text content for text attribute", () => {
    const map = toSelectorMap([
      createMockResults("test", [createMockItem("Hello world")]),
    ] as any);
    const source = { selector: "test", attribute: "text" as const };
    expect(getSelectorValue(map, source)).toBe("Hello world");
  });

  it("should return html content for text attribute when text is empty", () => {
    const map = toSelectorMap([
      createMockResults("test", [
        createMockItem(undefined, undefined),
      ] as any),
    ] as any);
    const source = { selector: "test", attribute: "text" as const };
    expect(getSelectorValue(map, source)).toBeUndefined();
  });

  it("should return attribute value for non-text attribute", () => {
    const map = toSelectorMap([
      createMockResults("test", [
        createMockItem("text", { href: "https://example.com" }),
      ]),
    ] as any);
    const source = { selector: "test", attribute: "href" as const };
    expect(getSelectorValue(map, source)).toBe("https://example.com");
  });

  it("should trim returned text", () => {
    const map = toSelectorMap([
      createMockResults("test", [createMockItem("  Hello world  ")]),
    ] as any);
    const source = { selector: "test", attribute: "text" as const };
    expect(getSelectorValue(map, source)).toBe("Hello world");
  });

  it("should return first non-empty result", () => {
    const map = toSelectorMap([
      createMockResults("test", [
        createMockItem(""),
        createMockItem(""),
        createMockItem("Actual text"),
      ]),
    ] as any);
    const source = { selector: "test", attribute: "text" as const };
    expect(getSelectorValue(map, source)).toBe("Actual text");
  });

  it("should return first item if no items have content", () => {
    const map = toSelectorMap([
      createMockResults("test", [
        createMockItem(""),
        createMockItem("text"),
      ]),
    ] as any);
    const source = { selector: "test", attribute: "text" as const };
    expect(getSelectorValue(map, source)).toBe("text");
  });
});

describe("firstFromSources", () => {
  it("should return undefined for empty sources", () => {
    const map = toSelectorMap([]);
    expect(firstFromSources(map, [])).toBeUndefined();
  });

  it("should return first matching source value", () => {
    const map = toSelectorMap([
      createMockResults("sel1", [createMockItem("value1")]),
      createMockResults("sel2", [createMockItem("value2")]),
    ] as any);
    const sources = [
      { selector: "sel1", attribute: "text" },
      { selector: "sel2", attribute: "text" },
    ];
    expect(firstFromSources(map, sources as any)).toBe("value1");
  });

  it("should skip to next source if first is empty", () => {
    const map = toSelectorMap([
      createMockResults("sel1", []),
      createMockResults("sel2", [createMockItem("value2")]),
    ] as any);
    const sources = [
      { selector: "sel1", attribute: "text" },
      { selector: "sel2", attribute: "text" },
    ];
    expect(firstFromSources(map, sources as any)).toBe("value2");
  });

  it("should return undefined if all sources are empty", () => {
    const map = toSelectorMap([
      createMockResults("sel1", []),
      createMockResults("sel2", []),
    ] as any);
    const sources = [
      { selector: "sel1", attribute: "text" },
      { selector: "sel2", attribute: "text" },
    ];
    expect(firstFromSources(map, sources as any)).toBeUndefined();
  });

  it("should trim the returned value", () => {
    const map = toSelectorMap([
      createMockResults("sel1", [createMockItem("  value  ")]),
    ] as any);
    const sources = [{ selector: "sel1", attribute: "text" }];
    expect(firstFromSources(map, sources as any)).toBe("value");
  });
});

describe("sanitizeText", () => {
  it("should return undefined for undefined input", () => {
    expect(sanitizeText(undefined, 100)).toBeUndefined();
  });

  it("should return undefined for null input", () => {
    expect(sanitizeText(null as any, 100)).toBeUndefined();
  });

  it("should return undefined for empty string", () => {
    expect(sanitizeText("", 100)).toBeUndefined();
  });

  it("should normalize whitespace to single spaces", () => {
    expect(sanitizeText("Hello    world", 100)).toBe("Hello world");
    expect(sanitizeText("Hello\nworld", 100)).toBe("Hello world");
    expect(sanitizeText("Hello\tworld", 100)).toBe("Hello world");
    expect(sanitizeText("Hello\r\nworld", 100)).toBe("Hello world");
  });

  it("should trim leading and trailing whitespace", () => {
    expect(sanitizeText("  Hello world  ", 100)).toBe("Hello world");
  });

  it("should return undefined for whitespace-only input", () => {
    expect(sanitizeText("   ", 100)).toBeUndefined();
    expect(sanitizeText("\n\t\r", 100)).toBeUndefined();
  });

  it("should truncate to maxLength", () => {
    const result = sanitizeText("a".repeat(200), 100);
    expect(result?.length).toBe(100);
  });

  it("should not truncate if under maxLength", () => {
    const text = "Hello world";
    expect(sanitizeText(text, 100)).toBe(text);
  });

  it("should handle mixed whitespace", () => {
    expect(sanitizeText("  Hello   \n\t world  \r\n  ", 100)).toBe(
      "Hello world"
    );
  });

  it("should preserve internal content within length limit", () => {
    const text = "Hello beautiful world";
    expect(sanitizeText(text, 20)).toBe("Hello beautiful worl");
  });
});

describe("sanitizeUrl", () => {
  const baseUrl = "https://example.com";

  it("should return undefined for undefined input", () => {
    expect(sanitizeUrl(baseUrl, undefined)).toBeUndefined();
  });

  it("should return undefined for null input", () => {
    expect(sanitizeUrl(baseUrl, null as any)).toBeUndefined();
  });

  it("should return undefined for empty string", () => {
    expect(sanitizeUrl(baseUrl, "")).toBeUndefined();
  });

  it("should return undefined for whitespace-only input", () => {
    expect(sanitizeUrl(baseUrl, "   ")).toBeUndefined();
  });

  it("should trim whitespace", () => {
    expect(sanitizeUrl(baseUrl, "  /path  ")).toBe("https://example.com/path");
  });

  it("should resolve relative URLs against base", () => {
    expect(sanitizeUrl(baseUrl, "/path")).toBe("https://example.com/path");
    expect(sanitizeUrl(baseUrl, "path")).toBe("https://example.com/path");
  });

  it("should return absolute URLs as-is", () => {
    expect(sanitizeUrl(baseUrl, "https://other.com/path")).toBe(
      "https://other.com/path"
    );
    expect(sanitizeUrl(baseUrl, "http://other.com/path")).toBe(
      "http://other.com/path"
    );
  });

  it("should reject javascript: URLs", () => {
    expect(sanitizeUrl(baseUrl, "javascript:alert(1)")).toBeUndefined();
    expect(sanitizeUrl(baseUrl, "JAVASCRIPT:alert(1)")).toBeUndefined();
  });

  it("should reject mailto: URLs", () => {
    expect(sanitizeUrl(baseUrl, "mailto:test@example.com")).toBeUndefined();
    expect(sanitizeUrl(baseUrl, "MAILTO:test@example.com")).toBeUndefined();
  });

  it("should reject non-http/https protocols", () => {
    expect(sanitizeUrl(baseUrl, "ftp://example.com")).toBeUndefined();
    expect(sanitizeUrl(baseUrl, "file:///etc/passwd")).toBeUndefined();
  });

  it("should reject data: URLs by default", () => {
    expect(sanitizeUrl(baseUrl, "data:image/png;base64,ABC")).toBeUndefined();
  });

  it("should allow data: URLs when allowData is true", () => {
    expect(
      sanitizeUrl(baseUrl, "data:image/png;base64,ABC", { allowData: true })
    ).toBe("data:image/png;base64,ABC");
  });

  it("should handle malformed URLs gracefully", () => {
    // http:// with base URL - throws error in Bun's URL constructor
    expect(sanitizeUrl(baseUrl, "http://")).toBeUndefined();
    // ://not-a-url with base URL - treated as a path
    expect(sanitizeUrl(baseUrl, "://not-a-url")).toBe("https://example.com/://not-a-url");
  });

  it("should preserve query parameters and fragments", () => {
    expect(sanitizeUrl(baseUrl, "/path?query=value#section")).toBe(
      "https://example.com/path?query=value#section"
    );
  });
});

describe("sanitizeImageUrl", () => {
  const baseUrl = "https://example.com";

  it("should return undefined for undefined input", () => {
    expect(sanitizeImageUrl(baseUrl, undefined)).toBeUndefined();
  });

  it("should return undefined for empty string", () => {
    expect(sanitizeImageUrl(baseUrl, "")).toBeUndefined();
  });

  it("should allow data: URLs for images", () => {
    expect(sanitizeImageUrl(baseUrl, "data:image/png;base64,ABC")).toBe(
      "data:image/png;base64,ABC"
    );
  });

  it("should trim whitespace before processing", () => {
    expect(sanitizeImageUrl(baseUrl, "  /image.png  ")).toBe(
      "https://example.com/image.png"
    );
  });

  it("should reject javascript: URLs", () => {
    expect(sanitizeImageUrl(baseUrl, "javascript:alert(1)")).toBeUndefined();
  });

  it("should resolve relative URLs", () => {
    expect(sanitizeImageUrl(baseUrl, "/images/photo.jpg")).toBe(
      "https://example.com/images/photo.jpg"
    );
  });

  it("should handle absolute URLs", () => {
    expect(sanitizeImageUrl(baseUrl, "https://cdn.example.com/image.png")).toBe(
      "https://cdn.example.com/image.png"
    );
  });

  it("should resolve relative paths", () => {
    // "not-a-url" is treated as a relative path
    expect(sanitizeImageUrl(baseUrl, "not-a-url")).toBe("https://example.com/not-a-url");
  });

  it("should allow data URLs with various mime types", () => {
    expect(sanitizeImageUrl(baseUrl, "data:image/jpeg;base64,ABC")).toBe(
      "data:image/jpeg;base64,ABC"
    );
    expect(sanitizeImageUrl(baseUrl, "data:image/gif;base64,ABC")).toBe(
      "data:image/gif;base64,ABC"
    );
    expect(sanitizeImageUrl(baseUrl, "data:image/svg+xml;base64,ABC")).toBe(
      "data:image/svg+xml;base64,ABC"
    );
  });

  it("should allow ALL data URLs, not just images", () => {
    // sanitizeImageUrl actually allows all data: URLs
    expect(
      sanitizeImageUrl(baseUrl, "data:text/html;base64,ABC")
    ).toBe("data:text/html;base64,ABC");
    expect(
      sanitizeImageUrl(baseUrl, "data:application/json;base64,ABC")
    ).toBe("data:application/json;base64,ABC");
  });
});
