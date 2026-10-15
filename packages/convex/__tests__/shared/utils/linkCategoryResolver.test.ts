import { describe, expect, it, test } from "bun:test";
import { resolveLinkCategory } from "../../../shared/utils/linkCategoryResolver";

describe("resolveLinkCategory", () => {
  describe("domain-based resolution", () => {
    it("should categorize a github.com owner page as software", () => {
      const result = resolveLinkCategory("https://github.com/microsoft");
      expect(result.category).toBe("software");
      expect(result.reason).toBe("domain_rule");
      expect(result.provider).toBe("github");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("should categorize gitlab.com site pages as software", () => {
      const result = resolveLinkCategory("https://gitlab.com/explore/projects");
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
      // github.com is a domain rule for software, /recipes would be a path rule
      const result = resolveLinkCategory("https://github.com/topics/recipes");
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
      const result = resolveLinkCategory(
        "https://github.com/vercel/next.js#readme"
      );
      expect(result.category).toBe("repo");
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
      const result = resolveLinkCategory("https://github.com/vercel/next.js/");
      expect(result.category).toBe("repo");
    });

    it("should be case insensitive for domains", () => {
      const result = resolveLinkCategory("https://GITHUB.COM/Vercel/Next.js");
      expect(result.category).toBe("repo");
    });

    it("should handle international domain names", () => {
      const result = resolveLinkCategory("https://müller.de/blog");
      expect(result.category).toBe("article");
    });
  });
});

const NEWER_CATEGORIES = [
  "place",
  "typeface",
  "social_post",
  "app",
  "game",
  "repo",
];

describe("newer categories", () => {
  test.each([
    // Code repositories: owner/repo paths and deeper, on the code hosts
    ["https://github.com/vercel/next.js", "repo"],
    ["https://www.github.com/vercel/next.js/tree/canary/packages", "repo"],
    ["https://github.com/vercel/next.js.git", "repo"],
    ["https://github.com/vercel/next.js/issues/1", "repo"],
    ["https://gitlab.com/gitlab-org/gitlab", "repo"],
    ["https://bitbucket.org/atlassian/python-bitbucket", "repo"],
    ["https://codeberg.org/forgejo/forgejo", "repo"],
    ["https://git.sr.ht/~sircmpwn/hare", "repo"],
    // Apps
    ["https://apps.apple.com/us/app/things-3/id904237743", "app"],
    ["https://play.google.com/store/apps/details?id=com.spotify.music", "app"],
    ["https://chromewebstore.google.com/detail/ublock/cjpalhdlnbpafiam", "app"],
    ["https://apps.microsoft.com/detail/9nblggh4nns1", "app"],
    // Games
    ["https://store.steampowered.com/app/1145360/Hades/", "game"],
    ["https://supergiant.itch.io/hades", "game"],
    ["https://store.epicgames.com/en-US/p/hades", "game"],
    ["https://www.gog.com/en/game/hades", "game"],
    ["https://boardgamegeek.com/boardgame/13/catan", "game"],
    // Places
    ["https://www.google.com/maps/place/Blue+Bottle+Coffee", "place"],
    ["https://maps.google.com/?q=coffee", "place"],
    ["https://maps.app.goo.gl/AbCdEf123", "place"],
    ["https://maps.apple.com/?q=coffee", "place"],
    ["https://www.yelp.com/biz/tartine-bakery-san-francisco", "place"],
    ["https://www.tripadvisor.com/Restaurant_Review-g60713", "place"],
    ["https://www.opentable.com/r/state-bird-provisions", "place"],
    ["https://resy.com/cities/ny/carbone", "place"],
    ["https://www.airbnb.com/rooms/12345", "place"],
    ["https://www.booking.com/hotel/fr/le-meurice.html", "place"],
    ["https://www.zillow.com/homedetails/1-Main-St/123_zpid/", "place"],
    ["https://www.redfin.com/CA/San-Francisco/1-Main-St/home/1", "place"],
    ["https://www.rightmove.co.uk/properties/123456", "place"],
    ["https://www.realtor.com/realestateandhomes-detail/1-Main-St", "place"],
    // Typefaces
    ["https://fonts.google.com/specimen/Inter", "typeface"],
    ["https://fonts.adobe.com/fonts/source-sans", "typeface"],
    ["https://www.myfonts.com/collections/helvetica-font-linotype", "typeface"],
    ["https://www.fontshare.com/fonts/satoshi", "typeface"],
    ["https://www.futurefonts.xyz/ohno/obviously", "typeface"],
    // Social posts
    ["https://x.com/jack/status/20", "social_post"],
    ["https://mobile.twitter.com/jack/status/20", "social_post"],
    ["https://www.instagram.com/p/DBY4WfSxA0a/", "social_post"],
    ["https://www.instagram.com/reel/Cr9Lx2xJ0Ab/", "social_post"],
    [
      "https://bsky.app/profile/jay.bsky.team/post/3l6oveex3ii2l",
      "social_post",
    ],
    ["https://www.threads.net/@zuck/post/C8abc123", "social_post"],
    ["https://www.threads.com/@zuck/post/C8abc123", "social_post"],
    ["https://www.tiktok.com/@scout/video/6718335390845095173", "social_post"],
    [
      "https://www.reddit.com/r/programming/comments/abc123/a_title/",
      "social_post",
    ],
    ["https://old.reddit.com/r/programming/comments/abc123/", "social_post"],
    [
      "https://www.linkedin.com/posts/janedoe_activity-7100-abcd",
      "social_post",
    ],
    [
      "https://www.linkedin.com/feed/update/urn:li:activity:7100/",
      "social_post",
    ],
    ["https://substack.com/@author/note/c-12345678", "social_post"],
    ["https://mastodon.social/@Gargron/109311046116149744", "social_post"],
    ["https://hachyderm.io/@nova/110000000000000000/", "social_post"],
  ] as const)("%s is %s", (url: string, category: string) => {
    const result = resolveLinkCategory(url);
    expect(result.category).toBe(category);
    expect(result.reason).toBe("domain_rule");
  });

  test.each([
    // Site pages and owners on code hosts are not repositories
    ["https://github.com/features/actions", "software"],
    ["https://github.com/pricing", "software"],
    ["https://github.com/orgs/vercel/repositories", "software"],
    ["https://github.com/marketplace/actions/checkout", "software"],
    ["https://github.com/topics/react", "software"],
    ["https://github.com/torvalds", "software"],
    ["https://gist.github.com/torvalds/1234567", "software"],
    ["https://docs.github.com/en/actions", "software"],
    // A Substack post stays an article; only notes are posts
    ["https://example.substack.com/p/a-long-read", "article"],
  ] as const)("%s stays %s", (url: string, category: string) => {
    expect(resolveLinkCategory(url).category).toBe(category);
  });

  test.each([
    "https://play.google.com/store/movies/details/Dune?id=abc",
    "https://www.google.com/search?q=maps",
    "https://www.reddit.com/r/programming/",
    "https://x.com/jack",
    "https://bsky.app/profile/jay.bsky.team",
    "https://www.tiktok.com/@scout2015",
    "https://apps.apple.com/us/charts/iphone",
    // A Mastodon-like path on a host that isn't a known instance
    "https://example.com/@alice/123456",
    "https://mastodon.social.example.com/@alice/123456",
    "https://mastodon.social/@Gargron",
  ])("%s is not one of the newer categories", (url: string) => {
    expect(NEWER_CATEGORIES).not.toContain(resolveLinkCategory(url).category);
  });

  it("keeps GitHub as the repo provider so its facts still apply", () => {
    expect(
      resolveLinkCategory("https://github.com/vercel/next.js")
    ).toMatchObject({ category: "repo", provider: "github" });
  });
});
