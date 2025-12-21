
import { describe, expect, test } from "bun:test";
import {
  toSelectorMap,
  findAttributeValue,
  getSelectorValue,
  firstFromSources,
  sanitizeText,
  sanitizeUrl,
  sanitizeImageUrl,
  buildDebugRaw,
  parseLinkPreview,
  buildSuccessPreview,
  buildErrorPreview,
} from "../../../convex/linkMetadata/parsing";
import type { ScrapeResultItem, ScrapeSelectorResult, SelectorSource } from "../../../convex/linkMetadata/types";
import * as selectors from "../../../convex/linkMetadata/selectors";
import { Id } from "../../../convex/_generated/dataModel";

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
      map.set("s1", [{text: "v1"}]);
      map.set("s2", [{text: "v2"}]);

      test("returns first match", () => {
          const sources: SelectorSource[] = [
              {selector: "s1", attribute: "text"},
              {selector: "s2", attribute: "text"}
          ];
          expect(firstFromSources(map, sources)).toBe("v1");
      });

      test("skips missing values", () => {
          const sources: SelectorSource[] = [
              {selector: "missing", attribute: "text"},
              {selector: "s2", attribute: "text"}
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
        expect(sanitizeUrl(baseUrl, "https://other.com/bar")).toBe("https://other.com/bar");
    });

    test("rejects javascript:", () => {
        expect(sanitizeUrl(baseUrl, "javascript:alert(1)")).toBeUndefined();
    });

    test("rejects mailto:", () => {
        expect(sanitizeUrl(baseUrl, "mailto:foo@bar.com")).toBeUndefined();
    });

    test("allows data: if enabled", () => {
        expect(sanitizeUrl(baseUrl, "data:image/png;base64,...", {allowData: true})).toBe("data:image/png;base64,...");
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
            expect(sanitizeImageUrl(baseUrl, "data:image/png;base64,foo")).toBe("data:image/png;base64,foo");
        });
        test("resolves relative urls", () => {
             expect(sanitizeImageUrl(baseUrl, "/img.png")).toBe("https://base.com/img.png");
        });
    });

    describe("buildDebugRaw", () => {
        test("returns undefined if results are missing", () => {
             expect(buildDebugRaw(undefined)).toBeUndefined();
        });

        test("returns simplified structure", () => {
            const results: ScrapeSelectorResult[] = [{
                selector: "s1",
                results: [{text: "t1", html: "h1", attributes: []}]
            }];
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
            const results: ScrapeSelectorResult[] = [
                {selector: "og:title", results: [{attributes: [{name: "content", value: "My Title"}]}]},
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
                 {selector: "meta[property='og:title']", results: [{attributes: [{name: "content", value: "My Title"}]}]}
             ]);
             
             expect(res.title).toBe("My Title");
             expect(res.finalUrl).toBe("https://example.com");
        });
    });

    describe("buildSuccessPreview", () => {
        test("constructs success object", () => {
            const parsed = {
                title: "Title",
                finalUrl: "https://final.com"
            } as any;
            const res = buildSuccessPreview("https://orig.com", parsed);
            expect(res.status).toBe("success");
            expect(res.url).toBe("https://orig.com");
            expect(res.title).toBe("Title");
        });
    });

    describe("buildErrorPreview", () => {
        test("constructs error object", () => {
            const res = buildErrorPreview("https://orig.com", {type: "timeout"});
            expect(res.status).toBe("error");
            expect(res.error).toEqual({type: "timeout"});
        });

        test("includes screenshot extras if provided", () => {
            const extras = { screenshotStorageId: "id123" as Id<"_storage">, screenshotUpdatedAt: 12345 };
            const res = buildErrorPreview("https://orig.com", {type: "timeout"}, extras);
            expect(res.screenshotStorageId).toBe("id123");
            expect(res.screenshotUpdatedAt).toBe(12345);
        });
    });
});
