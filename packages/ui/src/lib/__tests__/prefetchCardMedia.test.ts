import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { prefetchCardModalMedia } from "../prefetchCardMedia";

class StubImage {
  static created: StubImage[] = [];
  decoding?: string;
  src = "";

  constructor() {
    StubImage.created.push(this);
  }
}

const originalImage = globalThis.Image;
let urlSeed = 0;
// The module remembers every warmed URL for the page session, so each test
// uses fresh URLs to stay independent of test order.
const uniqueUrl = (name: string) =>
  `https://files.example.com/${++urlSeed}-${name}`;

beforeEach(() => {
  StubImage.created.length = 0;
  globalThis.Image = StubImage as unknown as typeof Image;
});

afterEach(() => {
  globalThis.Image = originalImage;
});

describe("lib/prefetchCardMedia", () => {
  test("warms the image modal's detail rendition once per url", () => {
    const card = {
      detailUrl: uniqueUrl("detail.webp"),
      fileUrl: uniqueUrl("original.jpg"),
      thumbnailUrl: uniqueUrl("thumb.webp"),
      type: "image",
    };

    prefetchCardModalMedia(card);
    prefetchCardModalMedia(card);

    expect(StubImage.created.map((image) => image.src)).toEqual([
      card.detailUrl,
    ]);
  });

  test("falls back to the thumbnail when an image has no detail rendition", () => {
    const thumbnailUrl = uniqueUrl("thumb.webp");

    prefetchCardModalMedia({
      fileUrl: uniqueUrl("original.jpg"),
      thumbnailUrl,
      type: "image",
    });

    expect(StubImage.created.map((image) => image.src)).toEqual([thumbnailUrl]);
  });

  test("warms only the poster for video cards and ignores other types", () => {
    const posterUrl = uniqueUrl("poster.webp");

    prefetchCardModalMedia({
      fileUrl: uniqueUrl("clip.mp4"),
      thumbnailUrl: posterUrl,
      type: "video",
    });
    prefetchCardModalMedia({
      content: "just text",
      type: "text",
    } as Parameters<typeof prefetchCardModalMedia>[0]);

    expect(StubImage.created.map((image) => image.src)).toEqual([posterUrl]);
  });
});
