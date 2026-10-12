import { describe, expect, test } from "bun:test";
import { getMoreInformationSections } from "../MoreInformationModal";

const baseCard = {
  createdAt: Date.UTC(2026, 0, 2, 3, 4),
  updatedAt: Date.UTC(2026, 0, 3, 3, 4),
};

const labels = (fields: { label: string }[]) =>
  fields.map((field) => field.label);

describe("getMoreInformationSections", () => {
  test("lists a link's author, publisher and publish date", () => {
    const sections = getMoreInformationSections({
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
    const sections = getMoreInformationSections({
      ...baseCard,
      type: "link",
      metadata: {
        linkPreview: { status: "success", publishedAt: "yesterday-ish" },
      },
    });
    expect(sections.source).toEqual([]);
  });

  test("shows an image's camera facts but never its location", () => {
    const sections = getMoreInformationSections({
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
      "Created",
      "Updated",
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
    const sections = getMoreInformationSections({
      ...baseCard,
      type: "image",
      fileMetadata: { fileName: "screenshot.png" },
    });
    expect(sections.camera).toEqual([]);
    expect(sections.source).toEqual([]);
  });
});
