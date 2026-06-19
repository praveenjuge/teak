import { describe, expect, test } from "bun:test";
import {
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
});
