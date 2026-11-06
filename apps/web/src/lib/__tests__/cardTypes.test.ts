import { describe, expect, test } from "bun:test";
import {
  cardDialogStage,
  cardTitle,
  isFileCardType,
  isGifCard,
} from "../cardTypes";

describe("card types", () => {
  test.each([
    ["image", true],
    ["video", true],
    ["audio", true],
    ["document", true],
    ["link", false],
    ["text", false],
    ["palette", false],
    ["quote", false],
    [undefined, false],
  ] as const)("%p is a file card: %p", (type, expected) => {
    expect(isFileCardType(type)).toBe(expected);
  });

  test.each([
    ["image", "media"],
    ["link", "media"],
    ["text", "text"],
    ["audio", "compact"],
    ["palette", "compact"],
  ] as const)("a %p card opens in a %p dialog", (type, stage) => {
    expect(cardDialogStage(type)).toBe(stage);
  });
});

describe("a GIF", () => {
  test("is known by its type alone, or by its name alone", () => {
    expect(isGifCard({ fileMetadata: { mimeType: "image/gif" } })).toBe(true);
    expect(isGifCard({ fileMetadata: { fileName: "dance.GIF" } })).toBe(true);
    expect(
      isGifCard({
        fileMetadata: { fileName: "dance.gif", mimeType: "image/gif" },
      })
    ).toBe(true);
  });

  test("is not a video that only has the name of one", () => {
    expect(
      isGifCard({
        fileMetadata: { fileName: "clip.gif", mimeType: "video/mp4" },
      })
    ).toBe(false);
    expect(isGifCard({ fileMetadata: { fileName: "clip.mp4" } })).toBe(false);
    expect(isGifCard({})).toBe(false);
  });
});

describe("cardTitle", () => {
  test("a link prefers its owner's title, then its page's, then its URL", () => {
    const link = {
      metadata: { linkPreview: { status: "success", title: "Page" } },
      type: "link",
      url: "https://a.com",
    };
    expect(cardTitle(link)).toBe("Page");
    expect(
      cardTitle({ ...link, metadataTitle: "Mine", metadataTitleEdited: true })
    ).toBe("Mine");
    expect(cardTitle({ type: "link", url: "https://a.com" })).toBe(
      "https://a.com"
    );
  });

  test("a file prefers its title to its name", () => {
    const file = { fileMetadata: { fileName: "lily.webp" }, type: "image" };
    expect(cardTitle(file)).toBe("lily.webp");
    expect(cardTitle({ ...file, metadataTitle: "Lily" })).toBe("Lily");
  });

  test("a note is named by its first line, as plain text", () => {
    expect(cardTitle({ content: "**Plan**\nmore", type: "text" })).toBe("Plan");
    expect(cardTitle({ content: "", type: "text" })).toBe("");
  });
});
