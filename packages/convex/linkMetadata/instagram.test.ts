import { describe, expect, it } from "bun:test";
import {
  buildInstagramPrimaryImageSnippet,
  extractInstagramPostCode,
  INSTAGRAM_HOSTNAME,
  INSTAGRAM_MEDIA_EVALUATOR,
  INSTAGRAM_MEDIA_MIN_DIM,
  INSTAGRAM_PRIMARY_IMAGE_EVALUATOR,
  INSTAGRAM_PRIMARY_IMAGE_MIN_DIM,
  INSTAGRAM_PRIMARY_IMAGE_WAIT_MS,
  isInstagramHostname,
  isInstagramPostUrl,
  isInstagramUrl,
  normalizeInstagramExtractedMedia,
} from "./instagram";

describe("instagram constants", () => {
  it("should have correct hostname constant", () => {
    expect(INSTAGRAM_HOSTNAME).toBe("instagram.com");
  });

  it("should have minimum dimension of 400", () => {
    expect(INSTAGRAM_PRIMARY_IMAGE_MIN_DIM).toBe(400);
  });

  it("should have media minimum dimension of 200", () => {
    expect(INSTAGRAM_MEDIA_MIN_DIM).toBe(200);
  });

  it("should have wait time of 3000ms", () => {
    expect(INSTAGRAM_PRIMARY_IMAGE_WAIT_MS).toBe(3000);
  });
});

describe("isInstagramHostname", () => {
  it("should return true for exact match", () => {
    expect(isInstagramHostname("instagram.com")).toBe(true);
  });

  it("should return true for subdomain", () => {
    expect(isInstagramHostname("www.instagram.com")).toBe(true);
    expect(isInstagramHostname("help.instagram.com")).toBe(true);
  });

  it("should return false for different hostname", () => {
    expect(isInstagramHostname("example.com")).toBe(false);
    expect(isInstagramHostname("instagram.fake.com")).toBe(false);
    expect(isInstagramHostname("com.instagram")).toBe(false);
  });

  it("should return false for similar but not matching hostnames", () => {
    expect(isInstagramHostname("instagram.org")).toBe(false);
    expect(isInstagramHostname("myinstagram.com")).toBe(false);
    expect(isInstagramHostname("instagram.com.example.com")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isInstagramHostname("")).toBe(false);
  });
});

describe("isInstagramUrl", () => {
  describe("valid Instagram URLs", () => {
    it("should return true for https://instagram.com", () => {
      expect(isInstagramUrl("https://instagram.com")).toBe(true);
    });

    it("should return true for http://instagram.com", () => {
      expect(isInstagramUrl("http://instagram.com")).toBe(true);
    });

    it("should return true for www subdomain", () => {
      expect(isInstagramUrl("https://www.instagram.com")).toBe(true);
    });

    it("should return true for Instagram post URLs", () => {
      expect(isInstagramUrl("https://www.instagram.com/p/ABC123/")).toBe(true);
      expect(isInstagramUrl("https://instagram.com/p/xyz/")).toBe(true);
    });

    it("should return true for Instagram profile URLs", () => {
      expect(isInstagramUrl("https://www.instagram.com/username/")).toBe(true);
      expect(isInstagramUrl("https://instagram.com/someuser/")).toBe(true);
    });

    it("should return true for Instagram reel URLs", () => {
      expect(isInstagramUrl("https://www.instagram.com/reel/ABC123/")).toBe(
        true
      );
    });

    it("should return true for subdomain URLs", () => {
      expect(isInstagramUrl("https://help.instagram.com")).toBe(true);
      expect(isInstagramUrl("https://about.instagram.com")).toBe(true);
    });

    it("should handle URLs with query parameters", () => {
      expect(
        isInstagramUrl("https://www.instagram.com/p/ABC123/?igshid=xyz")
      ).toBe(true);
    });

    it("should handle URLs with fragments", () => {
      expect(
        isInstagramUrl("https://www.instagram.com/p/ABC123/#section")
      ).toBe(true);
    });
  });

  describe("invalid Instagram URLs", () => {
    it("should return false for other domains", () => {
      expect(isInstagramUrl("https://example.com")).toBe(false);
      expect(isInstagramUrl("https://facebook.com")).toBe(false);
      expect(isInstagramUrl("https://twitter.com")).toBe(false);
    });

    it("should return false for similar but not matching domains", () => {
      expect(isInstagramUrl("https://instagram.org")).toBe(false);
      expect(isInstagramUrl("https://myinstagram.com")).toBe(false);
      expect(isInstagramUrl("https://instagram.fake.com")).toBe(false);
    });

    it("should return false for invalid URLs", () => {
      expect(isInstagramUrl("not a url")).toBe(false);
      expect(isInstagramUrl("instagram.com")).toBe(false); // missing protocol
      expect(isInstagramUrl("")).toBe(false);
      expect(isInstagramUrl("javascript:alert('xss')")).toBe(false);
    });

    it("should return false for malformed URLs", () => {
      expect(isInstagramUrl("https://")).toBe(false);
      expect(isInstagramUrl("://instagram.com")).toBe(false);
      // Note: ftp://instagram.com is technically a valid URL with instagram.com hostname
      // So isInstagramUrl returns true for it - this is expected behavior
      expect(isInstagramUrl("ftp://instagram.com")).toBe(true);
    });

    it("should handle edge cases gracefully", () => {
      // The .. prefix creates a valid hostname that ends with instagram.com
      expect(isInstagramUrl("https://..instagram.com")).toBe(true);
      // The .. in the middle doesn't match the instagram.com pattern
      expect(isInstagramUrl("https://instagram..com")).toBe(false);
      // Actual invalid URLs
      expect(isInstagramUrl("not-a-url")).toBe(false);
      expect(isInstagramUrl("https://")).toBe(false);
    });
  });
});

describe("Instagram post helpers", () => {
  it("extracts post or reel codes from supported URLs", () => {
    expect(
      extractInstagramPostCode("https://www.instagram.com/p/DBY4WfSxA0a/")
    ).toBe("DBY4WfSxA0a");
    expect(
      extractInstagramPostCode("https://www.instagram.com/reel/Cr9Lx2xJ0Ab/")
    ).toBe("Cr9Lx2xJ0Ab");
  });

  it("returns undefined for non-post URLs", () => {
    expect(
      extractInstagramPostCode("https://www.instagram.com/teakvault/")
    ).toBeUndefined();
  });

  it("detects supported Instagram post URLs", () => {
    expect(isInstagramPostUrl("https://www.instagram.com/p/DBY4WfSxA0a/")).toBe(
      true
    );
    expect(
      isInstagramPostUrl("https://www.instagram.com/reel/Cr9Lx2xJ0Ab/")
    ).toBe(true);
    expect(isInstagramPostUrl("https://www.instagram.com/teakvault/")).toBe(
      false
    );
  });
});

describe("normalizeInstagramExtractedMedia", () => {
  it("normalizes and deduplicates ordered instagram media", () => {
    const result = normalizeInstagramExtractedMedia(
      "https://www.instagram.com/p/DBY4WfSxA0a/",
      [
        {
          type: "image",
          url: "https://cdninstagram.com/media/one.jpg",
          contentType: "image/jpeg; charset=utf-8",
          width: 1080,
          height: 1350,
        },
        {
          type: "video",
          url: "https://cdninstagram.com/media/two.mp4?dl=1",
          posterUrl: "https://cdninstagram.com/media/two.jpg",
          posterContentType: "image/jpeg",
          width: 720,
          height: 1280,
          posterWidth: 720,
          posterHeight: 1280,
        },
        {
          type: "image",
          url: "https://cdninstagram.com/media/one.jpg",
          width: 1080,
          height: 1350,
        },
      ]
    );

    expect(result).toEqual([
      {
        type: "image",
        url: "https://cdninstagram.com/media/one.jpg",
        contentType: "image/jpeg",
        width: 1080,
        height: 1350,
      },
      {
        type: "video",
        url: "https://cdninstagram.com/media/two.mp4?dl=1",
        contentType: undefined,
        width: 720,
        height: 1280,
        posterUrl: "https://cdninstagram.com/media/two.jpg",
        posterContentType: "image/jpeg",
        posterWidth: 720,
        posterHeight: 1280,
      },
    ]);
  });

  it("infers media types and ignores invalid items", () => {
    const result = normalizeInstagramExtractedMedia(
      "https://www.instagram.com/p/DBY4WfSxA0a/",
      [
        {
          url: "https://cdninstagram.com/media/one.webp",
          width: 1080,
          height: 1080,
        },
        {
          url: "javascript:alert(1)",
        },
        {
          contentType: "video/mp4",
          url: "https://cdninstagram.com/media/reel.mp4",
          posterUrl: "https://cdninstagram.com/media/reel.jpg",
        },
      ]
    );

    expect(result).toEqual([
      {
        type: "image",
        url: "https://cdninstagram.com/media/one.webp",
        contentType: undefined,
        width: 1080,
        height: 1080,
      },
      {
        type: "video",
        url: "https://cdninstagram.com/media/reel.mp4",
        contentType: "video/mp4",
        width: undefined,
        height: undefined,
        posterUrl: "https://cdninstagram.com/media/reel.jpg",
        posterContentType: "image/jpeg",
        posterWidth: undefined,
        posterHeight: undefined,
      },
    ]);
  });

  it("returns undefined when no valid media is present", () => {
    expect(
      normalizeInstagramExtractedMedia(
        "https://www.instagram.com/p/DBY4WfSxA0a/",
        [{ url: "mailto:test@example.com" }]
      )
    ).toBeUndefined();
  });
});

describe("INSTAGRAM_PRIMARY_IMAGE_EVALUATOR", () => {
  it("should be a non-empty string", () => {
    expect(INSTAGRAM_PRIMARY_IMAGE_EVALUATOR.length).toBeGreaterThan(0);
  });

  it("should contain the MIN_DIM constant", () => {
    expect(INSTAGRAM_PRIMARY_IMAGE_EVALUATOR).toContain("const MIN_DIM");
    expect(INSTAGRAM_PRIMARY_IMAGE_EVALUATOR).toContain("400");
  });

  it("should contain key function logic", () => {
    expect(INSTAGRAM_PRIMARY_IMAGE_EVALUATOR).toContain("querySelectorAll");
    expect(INSTAGRAM_PRIMARY_IMAGE_EVALUATOR).toContain("naturalWidth");
    expect(INSTAGRAM_PRIMARY_IMAGE_EVALUATOR).toContain("visibleArea");
  });

  it("should define a function", () => {
    expect(INSTAGRAM_PRIMARY_IMAGE_EVALUATOR.trim().startsWith("() =>")).toBe(
      true
    );
  });
});

describe("INSTAGRAM_MEDIA_EVALUATOR", () => {
  it("should be a non-empty string", () => {
    expect(INSTAGRAM_MEDIA_EVALUATOR.length).toBeGreaterThan(0);
  });

  it("should collect images, videos, and json payloads", () => {
    expect(INSTAGRAM_MEDIA_EVALUATOR).toContain('querySelectorAll("img")');
    expect(INSTAGRAM_MEDIA_EVALUATOR).toContain('querySelectorAll("video")');
    expect(INSTAGRAM_MEDIA_EVALUATOR).toContain(
      "xdt_api__v1__media__shortcode__web_info"
    );
    expect(INSTAGRAM_MEDIA_EVALUATOR).toContain("pushMedia");
  });

  it("should prefer relay post media before dom fallback", () => {
    expect(INSTAGRAM_MEDIA_EVALUATOR).toContain("if (media.length === 0)");
    expect(INSTAGRAM_MEDIA_EVALUATOR).toContain("addRelayMedia");
    expect(INSTAGRAM_MEDIA_EVALUATOR).toContain("findRelayPostItem");
  });

  it("should match relay payloads for posts and reels when only code is present", () => {
    expect(INSTAGRAM_MEDIA_EVALUATOR).toContain('"/p/" + code + "/"');
    expect(INSTAGRAM_MEDIA_EVALUATOR).toContain('"/reel/" + code + "/"');
  });

  it("should filter out gif and chrome images", () => {
    expect(INSTAGRAM_MEDIA_EVALUATOR).toContain("profile picture");
    expect(INSTAGRAM_MEDIA_EVALUATOR).toContain("header, footer, nav, aside");
    expect(INSTAGRAM_MEDIA_EVALUATOR).toContain("\\.(gif)");
  });
});

describe("buildInstagramPrimaryImageSnippet", () => {
  it("should return a non-empty string", () => {
    const snippet = buildInstagramPrimaryImageSnippet();
    expect(snippet.length).toBeGreaterThan(0);
  });

  it("should contain try-catch blocks", () => {
    const snippet = buildInstagramPrimaryImageSnippet();
    expect(snippet).toContain("try {");
    expect(snippet).toContain("} catch {}");
  });

  it("should reference Instagram hostname", () => {
    const snippet = buildInstagramPrimaryImageSnippet();
    expect(snippet).toContain("instagram.com");
  });

  it("should detect supported instagram post paths", () => {
    const snippet = buildInstagramPrimaryImageSnippet();
    expect(snippet).toContain("isInstagramPost");
    expect(snippet).toContain("\\/(p|reel)\\/");
  });

  it("should include wait timeout constant", () => {
    const snippet = buildInstagramPrimaryImageSnippet();
    expect(snippet).toContain("3000");
  });

  it("should include minimum dimension constant", () => {
    const snippet = buildInstagramPrimaryImageSnippet();
    expect(snippet).toContain("400");
  });

  it("should include page.evaluate call", () => {
    const snippet = buildInstagramPrimaryImageSnippet();
    expect(snippet).toContain("page.evaluate");
  });

  it("should extract instagramMedia when available", () => {
    const snippet = buildInstagramPrimaryImageSnippet();
    expect(snippet).toContain("instagramMedia");
    expect(snippet).toContain(
      "const instagramExtraction = await page.evaluate"
    );
  });

  it("should include waitForFunction for image loading", () => {
    const snippet = buildInstagramPrimaryImageSnippet();
    expect(snippet).toContain("waitForFunction");
  });
});
