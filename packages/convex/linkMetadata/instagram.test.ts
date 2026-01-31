import { describe, expect, it } from "bun:test";
import {
  buildInstagramPrimaryImageSnippet,
  INSTAGRAM_HOSTNAME,
  INSTAGRAM_PRIMARY_IMAGE_EVALUATOR,
  INSTAGRAM_PRIMARY_IMAGE_MIN_DIM,
  INSTAGRAM_PRIMARY_IMAGE_WAIT_MS,
  isInstagramHostname,
  isInstagramUrl,
} from "./instagram";

describe("instagram constants", () => {
  it("should have correct hostname constant", () => {
    expect(INSTAGRAM_HOSTNAME).toBe("instagram.com");
  });

  it("should have minimum dimension of 400", () => {
    expect(INSTAGRAM_PRIMARY_IMAGE_MIN_DIM).toBe(400);
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

  it("should include waitForFunction for image loading", () => {
    const snippet = buildInstagramPrimaryImageSnippet();
    expect(snippet).toContain("waitForFunction");
  });
});
