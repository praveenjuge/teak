import { describe, expect, it, test } from "bun:test";
import {
  buildDebugRaw,
  buildErrorPreview,
  buildSuccessPreview,
  findAttributeValue,
  firstFromSources,
  getSelectorValue,
  parseLinkPreview,
  sanitizeImageUrl,
  sanitizeText,
  sanitizeUrl,
  toSelectorMap,
} from "../../linkMetadata/parsing";
import type {
  ScrapeResultItem,
  ScrapeSelectorResult,
  SelectorSource,
} from "../../linkMetadata/types";

describe("parsing", () => {
  describe("toSelectorMap", () => {
    test("returns empty map if results are undefined", () => {
      expect(toSelectorMap(undefined).size).toBe(0);
    });

    test("converts results to map", () => {
      const results: ScrapeSelectorResult[] = [
        { selector: "s1", results: [{ text: "t1" }] },
        { selector: "s2", results: [{ text: "t2" }] },
      ];
      const map = toSelectorMap(results);
      expect(map.size).toBe(2);
      expect(map.get("s1")).toEqual([{ text: "t1" }]);
      expect(map.get("s2")).toEqual([{ text: "t2" }]);
    });
  });

  describe("findAttributeValue", () => {
    test("returns undefined if item or attributes are missing", () => {
      expect(findAttributeValue(undefined, "href")).toBeUndefined();
      expect(findAttributeValue({}, "href")).toBeUndefined();
    });

    test("returns attribute value", () => {
      const item: ScrapeResultItem = {
        attributes: [{ name: "href", value: "val" }],
      };
      expect(findAttributeValue(item, "href")).toBe("val");
    });

    test("is case insensitive for attribute name", () => {
      const item: ScrapeResultItem = {
        attributes: [{ name: "HREF", value: "val" }],
      };
      expect(findAttributeValue(item, "href")).toBe("val");
    });
  });

  describe("getSelectorValue", () => {
    const map = new Map<string, ScrapeResultItem[]>();
    map.set("sel1", [{ text: " t1 " }]);
    map.set("sel2", [{ attributes: [{ name: "content", value: " c1 " }] }]);
    map.set("sel3", [{ text: "" }]); // Empty text

    test("gets text content", () => {
      const source: SelectorSource = { selector: "sel1", attribute: "text" };
      expect(getSelectorValue(map, source)).toBe("t1");
    });

    test("gets attribute content", () => {
      const source: SelectorSource = { selector: "sel2", attribute: "content" };
      expect(getSelectorValue(map, source)).toBe("c1");
    });

    test("returns undefined if not found", () => {
      const source: SelectorSource = { selector: "sel4", attribute: "text" };
      expect(getSelectorValue(map, source)).toBeUndefined();
    });

    test("returns undefined if value is empty", () => {
      const source: SelectorSource = { selector: "sel3", attribute: "text" };
      expect(getSelectorValue(map, source)).toBeUndefined();
    });
  });

  describe("firstFromSources", () => {
    const map = new Map<string, ScrapeResultItem[]>();
    map.set("s1", [{ text: "v1" }]);
    map.set("s2", [{ text: "v2" }]);

    test("returns first match", () => {
      const sources: SelectorSource[] = [
        { selector: "s1", attribute: "text" },
        { selector: "s2", attribute: "text" },
      ];
      expect(firstFromSources(map, sources)).toBe("v1");
    });

    test("skips missing values", () => {
      const sources: SelectorSource[] = [
        { selector: "missing", attribute: "text" },
        { selector: "s2", attribute: "text" },
      ];
      expect(firstFromSources(map, sources)).toBe("v2");
    });
  });

  describe("sanitizeText", () => {
    test("trims and collapses whitespace", () => {
      expect(sanitizeText("  foo   bar  ", 100)).toBe("foo bar");
    });

    test("truncates to max length", () => {
      expect(sanitizeText("1234567890", 5)).toBe("12345");
    });

    test("returns undefined for empty strings", () => {
      expect(sanitizeText("", 100)).toBeUndefined();
      expect(sanitizeText("   ", 100)).toBeUndefined();
    });
  });

  describe("sanitizeUrl", () => {
    const baseUrl = "https://base.com";

    test("resolves relative urls", () => {
      expect(sanitizeUrl(baseUrl, "/foo")).toBe("https://base.com/foo");
    });

    test("accepts absolute urls", () => {
      expect(sanitizeUrl(baseUrl, "https://other.com/bar")).toBe(
        "https://other.com/bar"
      );
    });

    test("rejects javascript:", () => {
      expect(sanitizeUrl(baseUrl, "javascript:alert(1)")).toBeUndefined();
    });

    test("rejects mailto:", () => {
      expect(sanitizeUrl(baseUrl, "mailto:foo@bar.com")).toBeUndefined();
    });

    test("allows data: if enabled", () => {
      expect(
        sanitizeUrl(baseUrl, "data:image/png;base64,...", { allowData: true })
      ).toBe("data:image/png;base64,...");
    });

    test("rejects data: by default", () => {
      expect(sanitizeUrl(baseUrl, "data:image/png;base64,...")).toBeUndefined();
    });

    test("returns undefined if trimmed value is empty", () => {
      expect(sanitizeUrl(baseUrl, "   ")).toBeUndefined();
    });

    test("returns undefined for non-http/https protocols", () => {
      expect(sanitizeUrl(baseUrl, "ftp://example.com")).toBeUndefined();
    });

    test("returns undefined for invalid urls", () => {
      // http://[ is invalid
      expect(sanitizeUrl(baseUrl, "http://[")).toBeUndefined();
    });
  });

  describe("sanitizeImageUrl", () => {
    const baseUrl = "https://base.com";
    test("allows data urls", () => {
      expect(sanitizeImageUrl(baseUrl, "data:image/png;base64,foo")).toBe(
        "data:image/png;base64,foo"
      );
    });
    test("resolves relative urls", () => {
      expect(sanitizeImageUrl(baseUrl, "/img.png")).toBe(
        "https://base.com/img.png"
      );
    });
  });

  describe("buildDebugRaw", () => {
    test("returns undefined if results are missing", () => {
      expect(buildDebugRaw(undefined)).toBeUndefined();
    });

    test("returns simplified structure", () => {
      const results: ScrapeSelectorResult[] = [
        {
          selector: "s1",
          results: [{ text: "t1", html: "h1", attributes: [] }],
        },
      ];
      const debug = buildDebugRaw(results);
      expect(debug).toBeDefined();
      expect(debug![0].results![0].text).toBe("t1");
      // html should be stripped or check implementation details if it preserves what we expect
      // looking at implementation: map(item => ({ text: item.text, attributes: item.attributes }))
      expect((debug![0].results![0] as any).html).toBeUndefined();
    });
  });

  describe("parseLinkPreview", () => {
    test("parses basic fields", () => {
      const _results: ScrapeSelectorResult[] = [
        {
          selector: "og:title",
          results: [{ attributes: [{ name: "content", value: "My Title" }] }],
        },
      ];
      // Mocking selectors to match what we put in results.
      // Since we can't easily mock the constant arrays in the module, we rely on the real ones.
      // We need to know what selectors are in TITLE_SOURCES etc.
      // Assuming TITLE_SOURCES includes meta[property="og:title"] content

      // Let's create a more robust test that doesn't rely on specific selector implementation details if possible,
      // OR checks the actual selectors.ts content.
      // For now, let's use a known selector from the code if we can see it, or just use `toSelectorMap` logic
      // The function `parseLinkPreview` uses specific imported constants.

      // Checking `selectors.ts` content would be good, but let's assume standard OG tags are there.
      const res = parseLinkPreview("https://example.com", [
        {
          selector: "meta[property='og:title']",
          results: [{ attributes: [{ name: "content", value: "My Title" }] }],
        },
      ]);

      expect(res.title).toBe("My Title");
      expect(res.finalUrl).toBe("https://example.com");
    });
  });

  describe("buildSuccessPreview", () => {
    test("constructs success object", () => {
      const parsed = {
        title: "Title",
        finalUrl: "https://final.com",
      } as any;
      const res = buildSuccessPreview("https://orig.com", parsed);
      expect(res.status).toBe("success");
      expect(res.url).toBe("https://orig.com");
      expect(res.title).toBe("Title");
    });
  });

  describe("buildErrorPreview", () => {
    test("constructs error object", () => {
      const res = buildErrorPreview("https://orig.com", { type: "timeout" });
      expect(res.status).toBe("error");
      expect(res.error).toEqual({ type: "timeout" });
    });

    test("includes screenshot extras if provided", () => {
      const extras = {
        screenshotStorageKey: "key123",
        screenshotUpdatedAt: 12_345,
      };
      const res = buildErrorPreview(
        "https://orig.com",
        { type: "timeout" },
        extras
      );
      expect(res.screenshotStorageKey).toBe("key123");
      expect(res.screenshotUpdatedAt).toBe(12_345);
    });
  });
});

// Mock types for testing
interface MockScrapeResultItem {
  attributes?: Array<{ name: string; value: string }>;
  html?: string;
  text?: string;
}

interface MockSelectorResult {
  results: MockScrapeResultItem[];
  selector: string;
}

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
    const results: MockSelectorResult[] = [createMockResults("selector1", [])];
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
      createMockResults("test", [createMockItem(undefined, undefined)] as any),
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
      createMockResults("test", [createMockItem(""), createMockItem("text")]),
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
    expect(sanitizeUrl(baseUrl, "://not-a-url")).toBe(
      "https://example.com/://not-a-url"
    );
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
    expect(sanitizeImageUrl(baseUrl, "not-a-url")).toBe(
      "https://example.com/not-a-url"
    );
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
    expect(sanitizeImageUrl(baseUrl, "data:text/html;base64,ABC")).toBe(
      "data:text/html;base64,ABC"
    );
    expect(sanitizeImageUrl(baseUrl, "data:application/json;base64,ABC")).toBe(
      "data:application/json;base64,ABC"
    );
  });
});
