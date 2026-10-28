import { describe, expect, test } from "bun:test";
import {
  assertImportCardCount,
  isSafeArchivePath,
  mimeMatchesType,
  validateImportCard,
} from "../../import/validate";

describe("Teak archive card validation", () => {
  test("rejects traversal, absolute paths, and remote file URLs", () => {
    expect(isSafeArchivePath("files/good.pdf")).toBe(true);
    expect(isSafeArchivePath("files/../secret")).toBe(false);
    expect(isSafeArchivePath("/files/secret")).toBe(false);
    expect(isSafeArchivePath("files\\secret.pdf")).toBe(false);
    expect(isSafeArchivePath("files/")).toBe(true);
    expect(() =>
      validateImportCard({
        type: "document",
        content: "bad",
        file: {
          path: "https://example.com/file.pdf",
          fileName: "file.pdf",
          mimeType: "application/pdf",
        },
      })
    ).toThrow("safe path");
  });

  test("rejects unsupported types, oversized files, and MIME mismatches", () => {
    expect(() =>
      validateImportCard({ type: "unknown", content: "bad" })
    ).toThrow("Unsupported");
    expect(() =>
      validateImportCard({
        type: "image",
        content: "bad",
        file: {
          path: "files/a.png",
          fileName: "a.png",
          fileSize: 21 * 1024 * 1024,
          mimeType: "image/png",
        },
      })
    ).toThrow("20 MiB");
    expect(mimeMatchesType("image", "application/pdf")).toBe(false);
  });

  test("accepts the current exported card timestamp and visible fields", () => {
    const card = validateImportCard({
      type: "link",
      content: "Title",
      url: "https://example.com",
      tags: ["Saved"],
      isFavorited: true,
      createdAt: { epochMs: 1_700_000_000_000, iso: "ignored" },
    });
    expect(card).toMatchObject({
      createdAt: 1_700_000_000_000,
      isFavorited: true,
      tags: ["Saved"],
    });
  });

  test("leaves the schema v2 fields out of a v1 card", () => {
    const card = validateImportCard({ type: "text", content: "Note" });
    expect(card.folders).toBeUndefined();
    expect(card.isArchived).toBeUndefined();
    expect(card.metadataTitle).toBeUndefined();
  });

  test("accepts schema v2 folders, archive state, and title, bounded", () => {
    const card = validateImportCard({
      type: "link",
      content: "x",
      url: "https://example.com",
      isArchived: true,
      metadataTitle: `  ${"t".repeat(600)}  `,
      folders: [
        " Reading ",
        "reading",
        "",
        "   ",
        "x".repeat(301),
        42,
        ...Array.from({ length: 60 }, (_, index) => `F${index}`),
      ],
      aiTags: ["ignored"],
      aiSummary: "ignored",
    });
    expect(card.isArchived).toBe(true);
    expect(card.metadataTitle).toBe("t".repeat(512));
    expect(card.folders?.[0]).toBe("Reading");
    expect(card.folders).toHaveLength(50);
    expect(card.folders).not.toContain("reading");
    expect(card).not.toHaveProperty("aiTags");
    expect(card).not.toHaveProperty("aiSummary");
  });

  test("keeps an exported link's done date, and no other card's", () => {
    const done = {
      epochMs: 1_780_000_000_000,
      iso: "2026-05-28T20:26:40.000Z",
    };
    expect(
      validateImportCard({
        type: "link",
        content: "x",
        url: "https://example.com",
        completedAt: done,
      }).completedAt
    ).toBe(1_780_000_000_000);
    expect(
      validateImportCard({ type: "text", content: "x", completedAt: done })
        .completedAt
    ).toBeUndefined();
    expect(
      validateImportCard({
        type: "link",
        content: "x",
        url: "https://example.com",
        completedAt: "soon",
      }).completedAt
    ).toBeUndefined();
  });

  test("never cuts a title inside an emoji", () => {
    const card = validateImportCard({
      type: "text",
      content: "x",
      metadataTitle: `${"a".repeat(511)}😀`,
    });
    expect(card.metadataTitle).toBe("a".repeat(511));
  });

  test("ignores isArchived values other than true, refuses non-list folders", () => {
    expect(
      validateImportCard({ type: "text", content: "x", isArchived: "yes" })
        .isArchived
    ).toBeUndefined();
    expect(() =>
      validateImportCard({ type: "text", content: "x", folders: "Reading" })
    ).toThrow("Card folders are invalid");
    expect(
      validateImportCard({ type: "text", content: "x", folders: null }).folders
    ).toBeUndefined();
  });

  test("keeps only a color's hex and name, which Convex's color validator takes", () => {
    // A `null` name or an unknown field would make Convex refuse the whole
    // batch of staged cards this one is in.
    expect(
      validateImportCard({
        type: "palette",
        content: "Sunset",
        colors: [
          { hex: "#FF8800", name: null },
          { hex: "#112233", name: "Navy", rgb: "17,34,51", extra: true },
        ],
      }).colors
    ).toEqual([{ hex: "#FF8800" }, { hex: "#112233", name: "Navy" }]);
  });

  test("reports card limits in terms of the selected import mode", () => {
    expect(() => assertImportCardCount(10_001, "bookmarks")).toThrow(
      "Bookmark file exceeds 10,000 bookmarks"
    );
    expect(() => assertImportCardCount(10_001, "archive")).toThrow(
      "Archive exceeds 10,000 cards"
    );
  });
});
