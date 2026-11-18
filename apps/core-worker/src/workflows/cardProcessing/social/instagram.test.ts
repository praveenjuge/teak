import { describe, expect, it } from "bun:test";
import {
  extractInstagramPostCode,
  isInstagramHostname,
  isInstagramPostUrl,
  normalizeInstagramExtractedMedia,
} from "./instagram";

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
