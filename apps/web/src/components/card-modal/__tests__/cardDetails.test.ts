import { describe, expect, test } from "bun:test";
import { getCardDetailSections } from "../cardDetails";

const baseCard = {
  createdAt: Date.UTC(2026, 0, 2, 3, 4),
  updatedAt: Date.UTC(2026, 0, 3, 3, 4),
};

const labels = (fields: { label: string }[]) =>
  fields.map((field) => field.label);

describe("getCardDetailSections", () => {
  test("lists a link's author, publisher and publish date", () => {
    const sections = getCardDetailSections({
      ...baseCard,
      type: "link",
      url: "https://example.com/story",
      metadata: {
        linkPreview: {
          status: "success",
          author: "Jane Doe",
          publisher: "The Daily Paper",
          publishedAt: "2024-03-05",
        },
      },
    });
    expect(sections.source).toEqual([
      { label: "Author", value: "Jane Doe" },
      { label: "Publisher", value: "The Daily Paper" },
      { label: "Published", value: "Mar 5, 2024" },
    ]);
    expect(sections.camera).toEqual([]);
  });

  test("hides a publish date the page wrote as garbage", () => {
    const sections = getCardDetailSections({
      ...baseCard,
      type: "link",
      metadata: {
        linkPreview: { status: "success", publishedAt: "yesterday-ish" },
      },
    });
    expect(sections.source).toEqual([]);
  });

  test("lists how much text Teak extracted from a document", () => {
    const sections = getCardDetailSections({
      ...baseCard,
      type: "document",
      extractedTextCharCount: 12_345,
    });
    expect(sections.details).toContainEqual({
      label: "Text",
      value: "12,345 characters extracted",
    });
    expect(
      labels(getCardDetailSections({ ...baseCard, type: "document" }).details)
    ).not.toContain("Text");
  });

  test("shows an image's camera facts but never its location", () => {
    const sections = getCardDetailSections({
      ...baseCard,
      type: "image",
      fileMetadata: {
        fileName: "IMG_0001.jpg",
        fileSize: 2 * 1024 * 1024,
        mimeType: "image/jpeg",
        exif: {
          make: "Apple",
          model: "iPhone 17 Pro",
          iso: 64,
          latitude: 37.3349,
          longitude: -122.009,
        },
      },
    });
    expect(labels(sections.details)).toEqual([
      "Added",
      "Edited",
      "File name",
      "File size",
      "File type",
    ]);
    expect(sections.details).toContainEqual({
      label: "File size",
      value: "2.0 MB",
    });
    expect(sections.camera).toEqual([
      { label: "Camera", value: "Apple iPhone 17 Pro" },
      { label: "ISO", value: "64" },
    ]);
    expect(JSON.stringify(sections)).not.toContain("37.33");
  });

  test("an image without EXIF has no camera section", () => {
    const sections = getCardDetailSections({
      ...baseCard,
      type: "image",
      fileMetadata: { fileName: "screenshot.png" },
    });
    expect(sections.camera).toEqual([]);
    expect(sections.source).toEqual([]);
  });

  test("leaves out the edit date of a card no one has changed since adding it", () => {
    const sections = getCardDetailSections({
      createdAt: Date.UTC(2026, 0, 2, 3, 4),
      updatedAt: Date.UTC(2026, 0, 2, 3, 4, 30),
    });
    expect(labels(sections.details)).toEqual(["Added"]);
  });

  test("shows when a link was saved again, beside the date it was first added", () => {
    const createdAt = Date.UTC(2025, 4, 6, 7, 8);
    const savedAt = Date.UTC(2026, 9, 20, 9, 30);
    const sections = getCardDetailSections(
      { createdAt, savedAt, updatedAt: savedAt },
      { locale: "en-US" }
    );
    expect(sections.details).toEqual([
      {
        label: "Added",
        value: new Date(createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      },
      {
        label: "Saved again",
        value: new Date(savedAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      },
    ]);
  });

  test("formats the saved-again date in the reader's language", () => {
    const createdAt = Date.UTC(2025, 4, 6, 7, 8);
    const savedAt = Date.UTC(2026, 9, 20, 9, 30);
    const [, savedAgain] = getCardDetailSections(
      { createdAt, savedAt, updatedAt: savedAt },
      { locale: "de-DE" }
    ).details;
    expect(savedAgain?.value).toContain("2026");
    expect(savedAgain?.value).toContain("Okt");
  });

  test("leaves out the saved-again date of a card saved only once", () => {
    const createdAt = Date.UTC(2026, 0, 2, 3, 4);
    expect(
      labels(
        getCardDetailSections({
          createdAt,
          savedAt: createdAt,
          updatedAt: createdAt,
        }).details
      )
    ).toEqual(["Added"]);
    expect(
      labels(
        getCardDetailSections({
          createdAt,
          savedAt: createdAt + 60_000,
          updatedAt: createdAt + 60_000,
        }).details
      )
    ).toEqual(["Added"]);
  });

  test("still shows an edit made after the link was saved again", () => {
    const createdAt = Date.UTC(2025, 4, 6, 7, 8);
    const savedAt = Date.UTC(2026, 9, 20, 9, 30);
    const sections = getCardDetailSections({
      createdAt,
      savedAt,
      updatedAt: savedAt + 2 * 60 * 60 * 1000,
    });
    expect(labels(sections.details)).toEqual([
      "Added",
      "Saved again",
      "Edited",
    ]);
  });
});
