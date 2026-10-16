import { describe, expect, it } from "bun:test";
import {
  isLinkCategory,
  LINK_CATEGORIES,
  LINK_CATEGORY_DEFAULT_CONFIDENCE,
  LINK_CATEGORY_ICONS,
  LINK_CATEGORY_LABELS,
  MASTODON_HOSTS,
  normalizeLinkCategory,
} from "../../shared/linkCategories";

describe("LINK_CATEGORIES", () => {
  it("should contain all expected categories", () => {
    const expected = [
      "book",
      "movie",
      "tv",
      "article",
      "news",
      "podcast",
      "music",
      "product",
      "recipe",
      "course",
      "research",
      "event",
      "software",
      "design_portfolio",
      "place",
      "typeface",
      "social_post",
      "app",
      "game",
      "repo",
      "other",
    ] as const;
    expect(LINK_CATEGORIES).toEqual(expected);
  });

  it("recognizes stored category values and rejects anything else", () => {
    expect(isLinkCategory("social_post")).toBe(true);
    expect(isLinkCategory("repo")).toBe(true);
    expect(isLinkCategory("Social Post")).toBe(false);
    expect(isLinkCategory("toString")).toBe(false);
  });

  it("should have unique categories", () => {
    const unique = new Set(LINK_CATEGORIES);
    expect(unique.size).toBe(LINK_CATEGORIES.length);
  });
});

describe("LINK_CATEGORY_LABELS", () => {
  it("should have labels for all categories", () => {
    for (const category of LINK_CATEGORIES) {
      expect(LINK_CATEGORY_LABELS[category]).toBeDefined();
    }
  });

  it("should have non-empty labels", () => {
    for (const category of LINK_CATEGORIES) {
      const label = LINK_CATEGORY_LABELS[category];
      expect(label?.length).toBeGreaterThan(0);
    }
  });

  it("should have user-friendly labels", () => {
    expect(LINK_CATEGORY_LABELS.book).toBe("Book / eBook");
    expect(LINK_CATEGORY_LABELS.movie).toBe("Movie / Film");
    expect(LINK_CATEGORY_LABELS.tv).toBe("TV Show / Series");
    expect(LINK_CATEGORY_LABELS.software).toBe("Software / Developer Tool");
  });

  it("labels the newer categories", () => {
    expect(LINK_CATEGORY_LABELS.place).toBe(
      "Place / Restaurant / Venue / Real Estate"
    );
    expect(LINK_CATEGORY_LABELS.typeface).toBe("Typeface / Font");
    expect(LINK_CATEGORY_LABELS.social_post).toBe("Social Post");
    expect(LINK_CATEGORY_LABELS.app).toBe("App / Mobile or Desktop App");
    expect(LINK_CATEGORY_LABELS.game).toBe("Game / Video Game");
    expect(LINK_CATEGORY_LABELS.repo).toBe("Code Repository");
  });
});

describe("LINK_CATEGORY_ICONS", () => {
  it("should have icons for all categories", () => {
    for (const category of LINK_CATEGORIES) {
      expect(LINK_CATEGORY_ICONS[category]).toBeDefined();
    }
  });

  it("should have non-empty icon names", () => {
    for (const category of LINK_CATEGORIES) {
      const icon = LINK_CATEGORY_ICONS[category];
      expect(icon?.length).toBeGreaterThan(0);
    }
  });

  it("should have appropriate icon names", () => {
    expect(LINK_CATEGORY_ICONS.book).toBe("Book");
    expect(LINK_CATEGORY_ICONS.movie).toBe("Clapperboard");
    expect(LINK_CATEGORY_ICONS.tv).toBe("Tv");
    expect(LINK_CATEGORY_ICONS.music).toBe("Music");
    expect(LINK_CATEGORY_ICONS.place).toBe("MapPin");
    expect(LINK_CATEGORY_ICONS.typeface).toBe("Type");
    expect(LINK_CATEGORY_ICONS.social_post).toBe("MessageSquare");
    expect(LINK_CATEGORY_ICONS.app).toBe("AppWindow");
    expect(LINK_CATEGORY_ICONS.game).toBe("Gamepad2");
    expect(LINK_CATEGORY_ICONS.repo).toBe("FolderGit2");
  });
});

describe("normalizeLinkCategory", () => {
  it("should normalize exact category matches", () => {
    expect(normalizeLinkCategory("book")).toBe("book");
    expect(normalizeLinkCategory("movie")).toBe("movie");
    expect(normalizeLinkCategory("tv")).toBe("tv");
    expect(normalizeLinkCategory("article")).toBe("article");
  });

  it("should be case insensitive", () => {
    expect(normalizeLinkCategory("BOOK")).toBe("book");
    expect(normalizeLinkCategory("Movie")).toBe("movie");
    expect(normalizeLinkCategory("TV")).toBe("tv");
    expect(normalizeLinkCategory("ArTiClE")).toBe("article");
  });

  it("should normalize label to category", () => {
    expect(normalizeLinkCategory("Book / eBook")).toBe("book");
    expect(normalizeLinkCategory("Movie / Film")).toBe("movie");
    expect(normalizeLinkCategory("TV Show / Series")).toBe("tv");
    expect(normalizeLinkCategory("Article / Long-form Post")).toBe("article");
  });

  it("should normalize parts of labels", () => {
    expect(normalizeLinkCategory("Book")).toBe("book");
    expect(normalizeLinkCategory("eBook")).toBe("book");
    expect(normalizeLinkCategory("Film")).toBe("movie");
    expect(normalizeLinkCategory("TV Show")).toBe("tv");
    expect(normalizeLinkCategory("Series")).toBe("tv");
  });

  it("should handle whitespace and special characters", () => {
    expect(normalizeLinkCategory("  book  ")).toBe("book");
    expect(normalizeLinkCategory("book/ebook")).toBe("book");
  });

  it("should handle hyphens, underscores, and mixed separators", () => {
    expect(normalizeLinkCategory("design_portfolio")).toBe("design_portfolio");
    expect(normalizeLinkCategory("design portfolio")).toBe("design_portfolio");
    expect(normalizeLinkCategory("design-portfolio")).toBe("design_portfolio");
    expect(normalizeLinkCategory("design---portfolio")).toBe(
      "design_portfolio"
    );
  });

  it("should normalize all category labels", () => {
    expect(normalizeLinkCategory("News Brief")).toBe("news");
    expect(normalizeLinkCategory("Blog Update")).toBe("news");
    expect(normalizeLinkCategory("Podcast Episode")).toBe("podcast");
    expect(normalizeLinkCategory("Audio Show")).toBe("podcast");
    expect(normalizeLinkCategory("Music Track")).toBe("music");
    expect(normalizeLinkCategory("Album")).toBe("music");
    expect(normalizeLinkCategory("Product")).toBe("product");
    expect(normalizeLinkCategory("Shopping Page")).toBe("product");
    expect(normalizeLinkCategory("Recipe")).toBe("recipe");
    expect(normalizeLinkCategory("Cooking Guide")).toBe("recipe");
    expect(normalizeLinkCategory("Course")).toBe("course");
    expect(normalizeLinkCategory("Tutorial")).toBe("course");
    expect(normalizeLinkCategory("Learning Resource")).toBe("course");
    expect(normalizeLinkCategory("Research Paper")).toBe("research");
    expect(normalizeLinkCategory("Academic Publication")).toBe("research");
    expect(normalizeLinkCategory("Event")).toBe("event");
    expect(normalizeLinkCategory("Webinar")).toBe("event");
    expect(normalizeLinkCategory("Meetup")).toBe("event");
    expect(normalizeLinkCategory("Software")).toBe("software");
    expect(normalizeLinkCategory("Developer Tool")).toBe("software");
    expect(normalizeLinkCategory("app")).toBe("app");
    expect(normalizeLinkCategory("App")).toBe("app");
    expect(normalizeLinkCategory("Mobile or Desktop App")).toBe("app");
    expect(normalizeLinkCategory("Restaurant")).toBe("place");
    expect(normalizeLinkCategory("Real Estate")).toBe("place");
    expect(normalizeLinkCategory("Font")).toBe("typeface");
    expect(normalizeLinkCategory("Social Post")).toBe("social_post");
    expect(normalizeLinkCategory("social-post")).toBe("social_post");
    expect(normalizeLinkCategory("Video Game")).toBe("game");
    expect(normalizeLinkCategory("Code Repository")).toBe("repo");
    expect(normalizeLinkCategory("Design Portfolio")).toBe("design_portfolio");
    expect(normalizeLinkCategory("Other")).toBe("other");
    expect(normalizeLinkCategory("Miscellaneous")).toBe("other");
  });

  it("should return null for invalid categories", () => {
    expect(normalizeLinkCategory("not-a-category")).toBeNull();
    expect(normalizeLinkCategory("random text")).toBeNull();
    expect(normalizeLinkCategory("")).toBeNull();
  });

  it("should return null for whitespace only", () => {
    expect(normalizeLinkCategory("   ")).toBeNull();
    expect(normalizeLinkCategory("\t\n")).toBeNull();
  });
});

describe("MASTODON_HOSTS", () => {
  it("lists bare hostnames", () => {
    expect(MASTODON_HOSTS).toContain("mastodon.social");
    for (const host of MASTODON_HOSTS) {
      expect(new URL(`https://${host}/`).hostname).toBe(host);
    }
  });
});

describe("LINK_CATEGORY_DEFAULT_CONFIDENCE", () => {
  it("should be a number between 0 and 1", () => {
    expect(LINK_CATEGORY_DEFAULT_CONFIDENCE).toBeGreaterThanOrEqual(0);
    expect(LINK_CATEGORY_DEFAULT_CONFIDENCE).toBeLessThanOrEqual(1);
  });

  it("should be a reasonable default confidence", () => {
    expect(LINK_CATEGORY_DEFAULT_CONFIDENCE).toBe(0.6);
  });
});
