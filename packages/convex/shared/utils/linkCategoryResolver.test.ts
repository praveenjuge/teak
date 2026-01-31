import { describe, expect, it } from "bun:test";
import { resolveLinkCategory } from "./linkCategoryResolver";

describe("resolveLinkCategory", () => {
  describe("domain-based resolution", () => {
    it("should categorize github.com as software", () => {
      const result = resolveLinkCategory("https://github.com/user/repo");
      expect(result.category).toBe("software");
      expect(result.reason).toBe("domain_rule");
      expect(result.provider).toBe("github");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("should categorize gitlab.com as software", () => {
      const result = resolveLinkCategory("https://gitlab.com/user/repo");
      expect(result.category).toBe("software");
      expect(result.reason).toBe("domain_rule");
    });

    it("should categorize npmjs.com as software", () => {
      const result = resolveLinkCategory("https://www.npmjs.com/package/name");
      expect(result.category).toBe("software");
      expect(result.reason).toBe("domain_rule");
    });

    it("should categorize imdb.com as movie", () => {
      const result = resolveLinkCategory(
        "https://www.imdb.com/title/tt1234567/"
      );
      expect(result.category).toBe("movie");
      expect(result.reason).toBe("domain_rule");
      expect(result.provider).toBe("imdb");
    });

    it("should categorize goodreads.com as book", () => {
      const result = resolveLinkCategory(
        "https://www.goodreads.com/book/show/123"
      );
      expect(result.category).toBe("book");
      expect(result.reason).toBe("domain_rule");
      expect(result.provider).toBe("goodreads");
    });

    it("should categorize amazon.com as product", () => {
      const result = resolveLinkCategory(
        "https://www.amazon.com/dp/B123456789"
      );
      expect(result.category).toBe("product");
      expect(result.reason).toBe("domain_rule");
      expect(result.provider).toBe("amazon");
    });

    it("should categorize youtube.com as tv", () => {
      const result = resolveLinkCategory("https://www.youtube.com/watch?v=123");
      expect(result.category).toBe("tv");
      expect(result.reason).toBe("domain_rule");
      expect(result.provider).toBe("youtube");
    });

    it("should categorize youtu.be short URLs as tv", () => {
      const result = resolveLinkCategory("https://youtu.be/123");
      expect(result.category).toBe("tv");
      expect(result.reason).toBe("domain_rule");
      expect(result.provider).toBe("youtube");
    });

    it("should categorize medium.com as article", () => {
      const result = resolveLinkCategory("https://medium.com/@user/article");
      expect(result.category).toBe("article");
      expect(result.reason).toBe("domain_rule");
      expect(result.provider).toBe("medium");
    });

    it("should categorize dribbble.com as design portfolio", () => {
      const result = resolveLinkCategory("https://dribbble.com/shots/123");
      expect(result.category).toBe("design_portfolio");
      expect(result.reason).toBe("domain_rule");
      expect(result.provider).toBe("dribbble");
    });

    it("should categorize spotify.com as music", () => {
      const result = resolveLinkCategory("https://open.spotify.com/track/123");
      expect(result.category).toBe("music");
      expect(result.reason).toBe("domain_rule");
      expect(result.provider).toBe("spotify");
    });

    it("should categorize spotify episode/show as podcast", () => {
      const result = resolveLinkCategory(
        "https://open.spotify.com/episode/123"
      );
      expect(result.category).toBe("podcast");
      expect(result.reason).toBe("domain_rule");
      expect(result.provider).toBe("spotify");
    });

    it("should categorize spotify show as podcast", () => {
      const result = resolveLinkCategory("https://open.spotify.com/show/123");
      expect(result.category).toBe("podcast");
      expect(result.reason).toBe("domain_rule");
    });

    it("should categorize podcasts.apple.com as podcast", () => {
      const result = resolveLinkCategory(
        "https://podcasts.apple.com/us/podcast/example/id123"
      );
      expect(result.category).toBe("podcast");
      expect(result.reason).toBe("domain_rule");
      expect(result.provider).toBe("apple");
    });

    it("should categorize netflix.com as tv", () => {
      const result = resolveLinkCategory("https://www.netflix.com/watch/123");
      expect(result.category).toBe("tv");
      expect(result.reason).toBe("domain_rule");
    });

    it("should handle subdomains", () => {
      // raw.githubusercontent.com becomes githubusercontent.com after stripping subdomains
      // So it doesn't match the github.com domain rule directly
      const result = resolveLinkCategory(
        "https://raw.githubusercontent.com/user/repo/main/file.js"
      );
      // It matches "github" provider hint in hostname instead
      expect(result.category).toBe("software");
      expect(result.reason).toBe("provider_mapping");
    });
  });

  describe("path-based resolution", () => {
    it("should categorize recipe in path as recipe", () => {
      const result = resolveLinkCategory(
        "https://example.com/recipes/chocolate-cake"
      );
      expect(result.category).toBe("recipe");
      expect(result.reason).toBe("path_rule");
    });

    it("should categorize /episode/ (singular) as podcast", () => {
      // The regex requires /episode/ not /episodes/
      const result = resolveLinkCategory("https://example.com/episode/123");
      expect(result.category).toBe("podcast");
      expect(result.reason).toBe("path_rule");
    });

    it("should categorize /episodes/ (plural) as tv (matches 'episode' in tv rule)", () => {
      // /episodes/ matches the tv rule which looks for "episode" without word boundaries
      const result = resolveLinkCategory("https://example.com/episodes/123");
      expect(result.category).toBe("tv");
      expect(result.reason).toBe("path_rule");
    });

    it("should categorize course in path as course", () => {
      const result = resolveLinkCategory(
        "https://example.com/courses/javascript-101"
      );
      expect(result.category).toBe("course");
      expect(result.reason).toBe("path_rule");
    });

    it("should categorize tutorial in path as course", () => {
      const result = resolveLinkCategory("https://example.com/tutorials/react");
      expect(result.category).toBe("course");
      expect(result.reason).toBe("path_rule");
    });

    it("should categorize research in path as research", () => {
      const result = resolveLinkCategory(
        "https://example.com/research-papers/ai"
      );
      expect(result.category).toBe("research");
      expect(result.reason).toBe("path_rule");
    });

    it("should categorize event in path as event", () => {
      const result = resolveLinkCategory(
        "https://example.com/events/2024/conference"
      );
      expect(result.category).toBe("event");
      expect(result.reason).toBe("path_rule");
    });

    it("should categorize shop in path as product", () => {
      const result = resolveLinkCategory(
        "https://example.com/shop/products/item"
      );
      expect(result.category).toBe("product");
      expect(result.reason).toBe("path_rule");
    });

    it("should categorize music in path as music", () => {
      const result = resolveLinkCategory(
        "https://example.com/music/albums/new-release"
      );
      expect(result.category).toBe("music");
      expect(result.reason).toBe("path_rule");
    });

    it("should categorize movie in path as movie", () => {
      const result = resolveLinkCategory(
        "https://example.com/movies/new-release"
      );
      expect(result.category).toBe("movie");
      expect(result.reason).toBe("path_rule");
    });

    it("should categorize series in path as tv", () => {
      const result = resolveLinkCategory(
        "https://example.com/series/breaking-bad"
      );
      expect(result.category).toBe("tv");
      expect(result.reason).toBe("path_rule");
    });
  });

  describe("provider-based resolution", () => {
    it("should match youtube provider in hostname", () => {
      const result = resolveLinkCategory(
        "https://youtube.not-the-real-domain.com/video"
      );
      expect(result.category).toBe("tv");
      expect(result.reason).toBe("provider_mapping");
      expect(result.provider).toBe("youtube");
    });

    it("should match spotify provider (via path rule for /track/)", () => {
      // /track/ matches the music path rule before provider mapping
      const result = resolveLinkCategory(
        "https://myspotify.site.com/track/123"
      );
      expect(result.category).toBe("music");
      expect(result.reason).toBe("path_rule"); // path rule takes precedence
      expect(result.provider).toBe("spotify");
    });

    it("should match github provider", () => {
      const result = resolveLinkCategory("https://mygithub.io/project");
      expect(result.category).toBe("software");
      expect(result.reason).toBe("provider_mapping");
      expect(result.provider).toBe("github");
    });

    it("should match medium provider", () => {
      const result = resolveLinkCategory("https://medium.example.com/article");
      expect(result.category).toBe("article");
      expect(result.reason).toBe("provider_mapping");
      expect(result.provider).toBe("medium");
    });

    it("should match imdb provider", () => {
      const result = resolveLinkCategory("https://imdb.something.net/title");
      expect(result.category).toBe("movie");
      expect(result.reason).toBe("provider_mapping");
      expect(result.provider).toBe("imdb");
    });
  });

  describe("heuristic-based resolution", () => {
    it("should detect blog in URL as article", () => {
      const result = resolveLinkCategory("https://example.com/blog/post-123");
      expect(result.category).toBe("article");
      expect(result.reason).toBe("heuristic");
    });

    it("should detect post in URL as article", () => {
      const result = resolveLinkCategory(
        "https://example.com/news/important-post"
      );
      expect(result.category).toBe("article");
      expect(result.reason).toBe("heuristic");
    });

    it("should detect news in URL as news", () => {
      const result = resolveLinkCategory(
        "https://example.com/press/announcement"
      );
      expect(result.category).toBe("news");
      expect(result.reason).toBe("heuristic");
    });

    it("should detect docs in URL as software", () => {
      const result = resolveLinkCategory(
        "https://example.com/docs/api/reference"
      );
      expect(result.category).toBe("software");
      expect(result.reason).toBe("heuristic");
    });

    it("should detect documentation in URL as software", () => {
      const result = resolveLinkCategory(
        "https://example.com/documentation/getting-started"
      );
      expect(result.category).toBe("software");
      expect(result.reason).toBe("heuristic");
    });

    it("should detect design in URL as design portfolio", () => {
      const result = resolveLinkCategory("https://example.com/design/work");
      expect(result.category).toBe("design_portfolio");
      expect(result.reason).toBe("heuristic");
    });

    it("should use siteName for heuristic", () => {
      const result = resolveLinkCategory("https://example.com/page", {
        siteName: "My Blog",
      });
      expect(result.category).toBe("article");
      expect(result.reason).toBe("heuristic");
    });

    it("should use title for heuristic", () => {
      const result = resolveLinkCategory("https://example.com/page", {
        title: "My Blog Post",
      });
      expect(result.category).toBe("article");
      expect(result.reason).toBe("heuristic");
    });
  });

  describe("fallback", () => {
    it("should return other for unknown URLs", () => {
      const result = resolveLinkCategory(
        "https://unknown-domain-12345.com/page"
      );
      expect(result.category).toBe("other");
      expect(result.reason).toBe("fallback");
      expect(result.confidence).toBeLessThan(0.5);
    });

    it("should handle invalid URLs", () => {
      const result = resolveLinkCategory("not-a-url");
      expect(result.category).toBe("other");
      expect(result.reason).toBe("fallback");
    });

    it("should handle empty URL", () => {
      const result = resolveLinkCategory("");
      expect(result.category).toBe("other");
      expect(result.reason).toBe("fallback");
    });
  });

  describe("priority order", () => {
    it("should prioritize domain rule over path rule", () => {
      // github.com is a domain rule for software, /docs would be a path rule
      const result = resolveLinkCategory(
        "https://github.com/user/repo/wiki/docs"
      );
      expect(result.category).toBe("software");
      expect(result.reason).toBe("domain_rule");
    });

    it("should prioritize path rule over provider mapping", () => {
      const result = resolveLinkCategory("https://myspotify.com/recipes/pasta");
      expect(result.category).toBe("recipe");
      expect(result.reason).toBe("path_rule");
    });

    it("should prioritize provider mapping over heuristic", () => {
      const result = resolveLinkCategory("https://myblogmedium.com/page");
      expect(result.category).toBe("article");
      expect(result.reason).toBe("provider_mapping");
    });
  });

  describe("confidence levels", () => {
    it("should have high confidence for domain rules", () => {
      const result = resolveLinkCategory("https://github.com/user/repo");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("should have medium-high confidence for path rules", () => {
      const result = resolveLinkCategory("https://example.com/recipe/pasta");
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.confidence).toBeLessThan(0.95);
    });

    it("should have medium confidence for provider mapping", () => {
      const result = resolveLinkCategory("https://mygithub.io/project");
      expect(result.confidence).toBeGreaterThan(0.6);
      expect(result.confidence).toBeLessThan(0.85);
    });

    it("should have lower confidence for heuristics", () => {
      const result = resolveLinkCategory("https://example.com/blog/post");
      expect(result.confidence).toBeGreaterThan(0.4);
      expect(result.confidence).toBeLessThan(0.7);
    });

    it("should have lowest confidence for fallback", () => {
      const result = resolveLinkCategory("https://unknown-xyz.com/page");
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe("special cases", () => {
    it("should handle URLs with query parameters", () => {
      const result = resolveLinkCategory(
        "https://youtube.com/watch?v=123&feature=share"
      );
      expect(result.category).toBe("tv");
    });

    it("should handle URLs with fragments", () => {
      const result = resolveLinkCategory("https://github.com/user/repo#readme");
      expect(result.category).toBe("software");
    });

    it("should handle URLs with ports", () => {
      // The path /docs/ doesn't have a trailing / after docs (it's the end)
      // So it matches the heuristic "docs" pattern instead
      const result = resolveLinkCategory("https://localhost:3000/docs/");
      expect(result.category).toBe("software");
      expect(result.reason).toBe("heuristic");
    });

    it("should handle URLs with authentication", () => {
      const result = resolveLinkCategory("https://user:pass@gitlab.com/repo");
      expect(result.category).toBe("software");
    });

    it("should handle URLs with IP addresses", () => {
      const result = resolveLinkCategory("https://192.168.1.1/page");
      expect(result.category).toBe("other");
    });

    it("should handle URLs with trailing slashes", () => {
      const result = resolveLinkCategory("https://github.com/user/repo/");
      expect(result.category).toBe("software");
    });

    it("should be case insensitive for domains", () => {
      const result = resolveLinkCategory("https://GITHUB.COM/user/repo");
      expect(result.category).toBe("software");
    });

    it("should handle international domain names", () => {
      const result = resolveLinkCategory("https://müller.de/blog");
      expect(result.category).toBe("article");
    });
  });
});
