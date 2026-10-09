// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { toMobileCardSummary } from "../../card/mobileCardSummaries";

describe("mobile card summaries", () => {
  test("returns compact display fields without full card content", () => {
    const longContent = "A".repeat(400);
    const summary = toMobileCardSummary({
      _creationTime: 1,
      _id: "card-1",
      colors: [{ hex: "#112233", percentage: 1 }],
      content: longContent,
      createdAt: 1,
      processingStatus: {},
      placeholderUrl: "https://example.com/tiny.jpg",
      thumbnailUrl: "https://example.com/thumb.jpg",
      type: "text",
      updatedAt: 1,
      userId: "user-1",
    });

    expect(summary.previewText).toHaveLength(280);
    expect(summary.thumbnailUrl).toBe("https://example.com/thumb.jpg");
    expect(summary.placeholderUrl).toBe("https://example.com/tiny.jpg");
    expect(summary.colors).toEqual(["#112233"]);
    expect(summary).not.toHaveProperty("content");
    expect(summary).not.toHaveProperty("aiTranscript");
    expect(summary).not.toHaveProperty("fileUrl");
  });

  const base = {
    _creationTime: 1,
    _id: "card-2",
    createdAt: 1,
    processingStatus: {},
    updatedAt: 1,
    userId: "user-1",
  };

  test("reports the media aspect ratio and favorite state for grid tiles", () => {
    const image = toMobileCardSummary({
      ...base,
      content: "",
      fileMetadata: { width: 1200, height: 800 },
      isFavorited: true,
      type: "image",
    });
    expect(image.aspectRatio).toBe(1.5);
    expect(image.isFavorited).toBe(true);

    const note = toMobileCardSummary({ ...base, content: "Hi", type: "text" });
    expect(note.aspectRatio).toBeUndefined();
    expect(note.isFavorited).toBeUndefined();
  });

  test("sizes link tiles from the image the summary shows", () => {
    const linkPreview = {
      imageHeight: 630,
      imageWidth: 1200,
      screenshotHeight: 1000,
      screenshotWidth: 800,
      status: "success",
      title: "Example",
    };
    const withImage = toMobileCardSummary({
      ...base,
      content: "",
      linkPreviewImageUrl: "https://example.com/og.jpg",
      metadata: { linkPreview },
      type: "link",
      url: "https://example.com",
    });
    expect(withImage.linkPreviewImageUrl).toBe("https://example.com/og.jpg");
    expect(withImage.aspectRatio).toBeCloseTo(1200 / 630);

    const screenshotOnly = toMobileCardSummary({
      ...base,
      content: "",
      metadata: { linkPreview },
      screenshotUrl: "https://example.com/shot.jpg",
      type: "link",
      url: "https://example.com",
    });
    expect(screenshotOnly.aspectRatio).toBe(0.8);
  });

  test("names an untitled link after its site instead of its URL", () => {
    const summary = toMobileCardSummary({
      ...base,
      content: "https://www.example.com/articles/42?ref=feed",
      type: "link",
      url: "https://www.example.com/articles/42?ref=feed",
    });
    expect(summary.title).toBe("example.com");
  });
});
