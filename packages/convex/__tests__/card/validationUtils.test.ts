// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { extractUrlFromContent } from "../../../convex/card/validationUtils";

describe("validationUtils", () => {
  describe("extractUrlFromContent", () => {
    test("returns empty cleaned content for blank input", () => {
      expect(extractUrlFromContent("   ")).toEqual({ cleanedContent: "" });
    });

    test("extracts and trims a standalone url", () => {
      expect(extractUrlFromContent("  https://example.com  ")).toEqual({
        url: "https://example.com",
        cleanedContent: "https://example.com",
      });
    });

    test("extracts url embedded in text", () => {
      expect(
        extractUrlFromContent("Check this https://example.com/page now")
      ).toEqual({
        url: "https://example.com/page",
        cleanedContent: "Check this https://example.com/page now",
      });
    });

    test("ignores invalid url candidates", () => {
      expect(extractUrlFromContent("https://example.com/[")).toEqual({
        url: "https://example.com/[",
        cleanedContent: "https://example.com/[",
      });
    });
  });
});
