import { describe, expect, test } from "bun:test";
import { enrichDribbble } from "../../../../../../convex/workflows/steps/categorization/providers/dribbble";

describe("enrichDribbble", () => {
    test("handles full stats extraction (Likes, Views, Comments) to cover mapLabelToStat", () => {
        const rawMap = new Map([
            // Use index 1, 2, 3 to Loop through extractTwitterStats
            ["meta[name='twitter:label1']", { attributes: [{ name: "content", value: "Likes" }] }],
            ["meta[name='twitter:data1']", { attributes: [{ name: "content", value: "10" }] }],
            ["meta[name='twitter:label2']", { attributes: [{ name: "content", value: "Views" }] }],
            ["meta[name='twitter:data2']", { attributes: [{ name: "content", value: "20" }] }],
            ["meta[name='twitter:label3']", { attributes: [{ name: "content", value: "Comments" }] }],
            ["meta[name='twitter:data3']", { attributes: [{ name: "content", value: "30" }] }],
            // Unknown label to hit mapLabelToStat fallback
            ["meta[name='twitter:label4']", { attributes: [{ name: "content", value: "Unknown" }] }],
            ["meta[name='twitter:data4']", { attributes: [{ name: "content", value: "99" }] }]
        ]);
        const result = enrichDribbble(rawMap);
        expect(result?.facts?.find(f => f.label === "Likes")?.value).toBe("10");
        expect(result?.facts?.find(f => f.label === "Views")?.value).toBe("20");
        expect(result?.facts?.find(f => f.label === "Comments")?.value).toBe("30");
    });

    test("handles keywords extraction with limit logic", () => {
        // "a, b, c, d, e, f" -> 6 items. extractKeywords should stop at 5 (coverage for break).
        const rawMap = new Map([
            ["meta[name='keywords']", { attributes: [{ name: "content", value: "a, b, c, d, e, f" }] }]
        ]);
        const result = enrichDribbble(rawMap);
        // The fact value uses slice(0, 3) so we can't verify 5 items directly in facts, but we can verify it ran without error
        // To verify the breakdown we would need to inspect 'raw' output but 'keywords' is in raw
        expect(result?.raw?.keywords).toEqual(["a", "b", "c", "d", "e"]); // Should limit to 5
        expect(result?.facts?.find(f => f.label === "Tags")?.value).toBe("a, b, c");
    });

    test("handles designer extraction with valid name", () => {
        const rawMap = new Map([
            ["meta[name='author']", { attributes: [{ name: "content", value: "John Doe" }] }]
        ]);
        const result = enrichDribbble(rawMap);
        expect(result?.facts?.find(f => f.label === "Designer")?.value).toBe("John Doe");
    });

    test("handles designer extraction fallback logic", () => {
        // 1. author is empty/invalid
        // 2. og:title has " by Designer Name on Dribbble"
        const rawMap = new Map([
            ["meta[name='author']", { attributes: [{ name: "content", value: "   " }] }],
            ["meta[property='og:title']", { attributes: [{ name: "content", value: "Shot by Jane Doe on Dribbble" }] }]
        ]);
        const result = enrichDribbble(rawMap);
        expect(result?.facts?.find(f => f.label === "Designer")?.value).toBe("Jane Doe");
    });

    test("handles extractStat seeding logic coverage", () => {
        // Only provide twitter like ("10"). LIKES_SELECTORS are not populated.
        // extractStat will use the seed.
        const rawMap = new Map([
            ["meta[name='twitter:label1']", { attributes: [{ name: "content", value: "Likes" }] }],
            ["meta[name='twitter:data1']", { attributes: [{ name: "content", value: "10" }] }]
        ]);
        // LIKES_SELECTORS: "a[href$='/likes']" etc. We ensure these don't exist in rawMap (empty map + twitter stuff)

        const result = enrichDribbble(rawMap);
        // Should find 10 via seed
        expect(result?.facts?.find(f => f.label === "Likes")?.value).toBe("10");
    });

    test("handles extractStat fallback to selectors", () => {
        // No twitter seed. Provide selector data "a[href$='/likes']" -> "55"
        const rawMap = new Map([
            ["a[href$='/likes']", { text: "55" }]
        ]);
        const result = enrichDribbble(rawMap);
        expect(result?.facts?.find(f => f.label === "Likes")?.value).toBe("55");
    });

    test("handles getFirstAttribute loop coverage", () => {
        // KEYWORDS_SELECTORS has multiple entries. Provide 2nd or 3rd to force loop.
        // "meta[name='keywords']" is first.
        // "meta[name='parsely-tags']" is second.
        const rawMap = new Map([
            ["meta[name='parsely-tags']", { attributes: [{ name: "content", value: "tag1" }] }]
        ]);
        const result = enrichDribbble(rawMap);
        expect(result?.raw?.keywords).toEqual(["tag1"]);
    });
});
