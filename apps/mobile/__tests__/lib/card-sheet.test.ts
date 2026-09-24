import { describe, expect, test } from "bun:test";
import type { CardSheetDetail } from "../../lib/card-sheet";
import {
  buildDownloadFileName,
  formatFileSize,
  formatSheetTimestamp,
  getSheetCopyText,
  getSheetDetailRows,
  getSheetShareTarget,
} from "../../lib/card-sheet";

const baseCard = {
  _creationTime: 1_782_000_000_000,
  _id: "card1",
  content: "",
  createdAt: 1_782_000_000_000,
  updatedAt: 1_782_000_100_000,
  userId: "user1",
} as unknown as CardSheetDetail;

// Fixed fixture: 2026-06-21T00:00:00Z. Keep the year assertions below in
// sync if this timestamp ever changes.
const FIXTURE_TIMESTAMP = 1_782_000_000_000;

describe("formatSheetTimestamp", () => {
  test("formats a timestamp with date and time", () => {
    const formatted = formatSheetTimestamp(FIXTURE_TIMESTAMP);

    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).toContain("2026");
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("formatFileSize", () => {
  test("formats byte counts with units", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1_572_864)).toBe("1.5 MB");
    expect(formatFileSize(2_147_483_648)).toBe("2 GB");
  });
});

describe("getSheetDetailRows", () => {
  test("labels the card type and link website", () => {
    const rows = getSheetDetailRows({
      ...baseCard,
      type: "link",
      url: "https://www.example.com/some/path?query=1",
    });

    expect(rows).toContainEqual({ label: "Type", value: "Link" });
    expect(rows).toContainEqual({ label: "Website", value: "example.com" });
  });

  test("includes file facts for documents", () => {
    const rows = getSheetDetailRows({
      ...baseCard,
      fileMetadata: {
        fileName: "deck.pdf",
        fileSize: 2048,
        mimeType: "application/pdf",
      },
      type: "document",
    });

    expect(rows).toContainEqual({ label: "Type", value: "Document" });
    expect(rows).toContainEqual({ label: "File", value: "deck.pdf" });
    expect(rows).toContainEqual({
      label: "Format",
      value: "application/pdf",
    });
    expect(rows).toContainEqual({ label: "Size", value: "2 KB" });
  });

  test("includes dimensions and duration when present", () => {
    const rows = getSheetDetailRows({
      ...baseCard,
      fileMetadata: { duration: 65, height: 1080, width: 1920 },
      type: "video",
    });

    expect(rows).toContainEqual({
      label: "Dimensions",
      value: "1920 × 1080",
    });
    expect(rows).toContainEqual({ label: "Duration", value: "1:05" });
  });

  test("omits rows without data", () => {
    const rows = getSheetDetailRows({ ...baseCard, type: "text" });

    expect(rows).toEqual([{ label: "Type", value: "Text" }]);
  });

  test("includes the metadata description", () => {
    const rows = getSheetDetailRows({
      ...baseCard,
      metadataDescription: "A great read.",
      type: "link",
      url: "https://example.com",
    });

    expect(rows).toContainEqual({
      label: "Description",
      value: "A great read.",
    });
  });

  test("drops file facts that duplicate the card type", () => {
    const rows = getSheetDetailRows({
      ...baseCard,
      fileMetadata: { fileName: "photo.jpg", kind: "image" },
      type: "image",
    });

    expect(rows).not.toContainEqual(
      expect.objectContaining({ label: "Details" })
    );
    expect(rows).toContainEqual({ label: "File", value: "photo.jpg" });
  });
});

describe("getSheetCopyText", () => {
  test("copies content for text and quote cards", () => {
    expect(
      getSheetCopyText({ ...baseCard, content: "hello", type: "text" })
    ).toBe("hello");
    expect(
      getSheetCopyText({ ...baseCard, content: "to be", type: "quote" })
    ).toBe("to be");
  });

  test("copies the URL for link cards", () => {
    expect(
      getSheetCopyText({
        ...baseCard,
        type: "link",
        url: "https://example.com",
      })
    ).toBe("https://example.com");
  });

  test("copies hex values for palette cards", () => {
    expect(
      getSheetCopyText({
        ...baseCard,
        colors: [{ hex: "#ff0000" }, { hex: "#00ff00" }],
        type: "palette",
      })
    ).toBe("#ff0000, #00ff00");
  });

  test("returns null when nothing meaningful can be copied", () => {
    expect(getSheetCopyText({ ...baseCard, type: "image" })).toBeNull();
    expect(
      getSheetCopyText({ ...baseCard, content: "   ", type: "text" })
    ).toBeNull();
  });

  test("falls back to content when a link has no URL", () => {
    expect(
      getSheetCopyText({ ...baseCard, content: "note", type: "link" })
    ).toBe("note");
  });
});

describe("buildDownloadFileName", () => {
  test("prefers the known file name", () => {
    expect(buildDownloadFileName("https://files.example/a", "photo.jpg")).toBe(
      "photo.jpg"
    );
  });

  test("falls back to the URL path segment", () => {
    expect(
      buildDownloadFileName("https://files.example/uploads/report.pdf")
    ).toBe("report.pdf");
  });

  test("generates a download name when nothing is known", () => {
    expect(buildDownloadFileName(null)).toMatch(/^download-\d+$/);
    expect(buildDownloadFileName("not a url")).toMatch(/^download-\d+$/);
  });
});

describe("getSheetShareTarget", () => {
  test("shares link URLs directly", () => {
    expect(
      getSheetShareTarget({
        ...baseCard,
        type: "link",
        url: "https://example.com",
      })
    ).toEqual({ item: "https://example.com", kind: "item" });
  });

  test("shares text content directly", () => {
    expect(
      getSheetShareTarget({ ...baseCard, content: "hi", type: "text" })
    ).toEqual({ item: "hi", kind: "item" });
  });

  test("shares media as a downloadable file", () => {
    expect(
      getSheetShareTarget({
        ...baseCard,
        fileMetadata: { fileName: "photo.jpg" },
        fileUrl: "https://files.example/photo.jpg",
        type: "image",
      })
    ).toEqual({
      fileName: "photo.jpg",
      kind: "file",
      url: "https://files.example/photo.jpg",
    });
  });

  test("returns none when nothing can be shared", () => {
    expect(getSheetShareTarget({ ...baseCard, type: "image" })).toEqual({
      kind: "none",
    });
  });

  test("shares palette hexes as text", () => {
    expect(
      getSheetShareTarget({
        ...baseCard,
        colors: [{ hex: "#ff0000" }],
        type: "palette",
      })
    ).toEqual({ item: "#ff0000", kind: "item" });
  });

  test("attaches the link title as share subject", () => {
    expect(
      getSheetShareTarget({
        ...baseCard,
        metadataTitle: "Example",
        type: "link",
        url: "https://example.com",
      })
    ).toEqual({
      item: "https://example.com",
      kind: "item",
      subject: "Example",
    });
  });

  test("names image fallbacks from their own URL", () => {
    expect(
      getSheetShareTarget({
        ...baseCard,
        fileMetadata: { fileName: "photo.heic" },
        thumbnailUrl: "https://files.example/thumb.jpg",
        type: "image",
      })
    ).toEqual({
      fileName: "thumb.jpg",
      kind: "file",
      url: "https://files.example/thumb.jpg",
    });
  });

  test("refuses to share video thumbnails as the original file", () => {
    expect(
      getSheetShareTarget({
        ...baseCard,
        fileMetadata: { fileName: "clip.mp4" },
        thumbnailUrl: "https://files.example/thumb.jpg",
        type: "video",
      })
    ).toEqual({ kind: "none" });
  });
});
