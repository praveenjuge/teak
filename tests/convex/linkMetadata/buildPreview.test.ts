// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { buildErrorPreview, buildSuccessPreview } from '../../../convex/linkMetadata/parsing';

describe("link preview builders", () => {
  test("buildSuccessPreview merges parsed content", () => {
    const preview = buildSuccessPreview("https://example.com", {
      title: "Title",
      description: "Desc",
      imageUrl: "https://example.com/img.png",
      faviconUrl: undefined,
      siteName: "Example",
      author: undefined,
      publisher: undefined,
      publishedAt: undefined,
      canonicalUrl: undefined,
      finalUrl: "https://example.com",
      raw: undefined,
    });

    expect(preview.status).toBe("success");
    expect(preview.url).toBe("https://example.com");
    expect(preview.title).toBe("Title");
    expect(typeof preview.fetchedAt).toBe("number");
  });

  test("buildErrorPreview includes extras when present", () => {
    const preview = buildErrorPreview(
      "https://example.com",
      { type: "error", message: "nope" },
      { screenshotStorageId: "file123", screenshotUpdatedAt: 123 }
    );

    expect(preview.status).toBe("error");
    expect(preview.finalUrl).toBe("https://example.com");
    expect(preview.screenshotStorageId).toBe("file123");
    expect(preview.screenshotUpdatedAt).toBe(123);
  });
});
