// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { resolveLinkCategory } from "../convex/shared/utils/linkCategoryResolver";

describe("linkCategoryResolver", () => {
  test("uses domain rule for known providers", () => {
    const result = resolveLinkCategory("https://github.com/owner/repo");
    expect(result.category).toBe("software");
    expect(result.reason).toBe("domain_rule");
  });

  test("uses path rule when domain is unknown", () => {
    const result = resolveLinkCategory("https://example.com/recipes/tacos");
    expect(result.category).toBe("recipe");
    expect(result.reason).toBe("path_rule");
  });

  test("uses provider mapping when hostname hints", () => {
    const result = resolveLinkCategory("https://music.apple.com/us/album/123");
    expect(result.category).toBe("music");
    expect(["provider_mapping", "domain_rule"]).toContain(result.reason);
  });

  test("falls back when no match", () => {
    const result = resolveLinkCategory("not-a-url");
    expect(result.category).toBe("other");
    expect(result.reason).toBe("fallback");
  });
});
