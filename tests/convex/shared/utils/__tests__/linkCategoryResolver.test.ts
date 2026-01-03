// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { resolveLinkCategory } from '../../../../../convex/shared/utils/linkCategoryResolver';

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

  it("uses domain rule with path inclusion", () => {
      const result = resolveLinkCategory("https://open.spotify.com/episode/123");
      expect(result.category).toBe("podcast");
      expect(result.reason).toBe("domain_rule");
  });

  it("uses heuristic for blog posts", () => {
      const result = resolveLinkCategory("https://unknown.com/my-blog-post");
      expect(result.category).toBe("article");
      expect(result.reason).toBe("heuristic");
  });

  it("uses provider mapping for known provider in hostname", () => {
      // Use a path that doesn't trigger path rules (avoid 'album', 'music', etc.)
      const result = resolveLinkCategory("https://bandcamp.com/discover");
      expect(result.category).toBe("music");
      expect(result.reason).toBe("provider_mapping");
  });

  it("skips domain rule if path requirement not met", () => {
      // open.spotify.com has a rule for /episode (podcast), and a catch-all (music)
      const result = resolveLinkCategory("https://open.spotify.com/track/123");
      expect(result.category).toBe("music");
      expect(result.reason).toBe("domain_rule");
  });
});

