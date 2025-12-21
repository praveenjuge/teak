
import { describe, expect, test } from "bun:test";
import { normalizeLinkCategory, LINK_CATEGORIES, LINK_CATEGORY_LABELS } from "../../../convex/shared/linkCategories";

describe("linkCategories", () => {
    test("LINK_CATEGORIES contains expected values", () => {
        expect(LINK_CATEGORIES).toContain("software");
        expect(LINK_CATEGORIES).toContain("recipe");
        expect(LINK_CATEGORIES).toContain("music");
    });

    describe("normalizeLinkCategory", () => {
        test("normalizes exact matches", () => {
            expect(normalizeLinkCategory("software")).toBe("software");
        });

        test("normalizes labels", () => {
            expect(normalizeLinkCategory("Software / App / GitHub Project")).toBe("software");
        });

        test("normalizes parts of labels", () => {
            expect(normalizeLinkCategory("GitHub Project")).toBe("software");
            expect(normalizeLinkCategory("App")).toBe("software");
        });

        test("normalizes case insensitive", () => {
            expect(normalizeLinkCategory("SOFTWARE")).toBe("software");
        });

        test("returns null for unknown", () => {
            expect(normalizeLinkCategory("unknown")).toBeNull();
        });

        test("returns null for empty", () => {
            expect(normalizeLinkCategory("")).toBeNull();
        });
    });
});
