import { describe, expect, it } from "bun:test";
import { resolveLinkCategory } from "../linkCategoryResolver";

describe("resolveLinkCategory", () => {
  it("routes well-known domains deterministically", () => {
    const result = resolveLinkCategory("https://github.com/teak/app");

    expect(result.category).toBe("software");
    expect(result.provider).toBe("github");
    expect(result.reason).toBe("domain_rule");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("applies path-based rules when domains are unknown", () => {
    const result = resolveLinkCategory("https://example.com/recipes/best-lasagna");

    expect(result.category).toBe("recipe");
    expect(result.reason).toBe("path_rule");
  });

  it("falls back to provider mappings when available", () => {
    const result = resolveLinkCategory("https://soundcloud.com/artist/track-1");

    expect(result.category).toBe("music");
    expect(result.provider).toBe("soundcloud");
    expect(["path_rule", "provider_mapping"]).toContain(result.reason);
  });

  it("defaults to other when nothing matches", () => {
    const result = resolveLinkCategory("https://unknown.example.com/path/to/resource");

    expect(result.category).toBe("other");
    expect(result.reason).toBe("fallback");
  });
});
