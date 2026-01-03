// @ts-nocheck
import { mock, test, expect } from "bun:test";

// Mock providers to return content even if provider is missing (to test dead code)
mock.module("../../../../../convex/workflows/steps/categorization/providers", () => ({
    enrichProvider: (provider: any) => {
        if (!provider) return { raw: { "test": "data" } };
        return null;
    }
}));

import { enrichLinkCategory } from '../../../../../convex/workflows/steps/categorization/index';

test("enrichLinkCategory hits dead code branch with mocked provider", async () => {
    // We pass no URL and no hint so provider will be undefined
    const card = { _id: "c1", type: "link", url: "" };
    const classification = { category: "article", confidence: 1 };

    // enrichProvider is mocked to return { raw: ... } even if provider is undefined
    const result = await enrichLinkCategory(card, classification);

    // It should have hit the else if branch and merged raw
    expect(result.raw).toEqual({ provider: { "test": "data" } });
});
