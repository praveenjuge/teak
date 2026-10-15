import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createMediaPrefetcher } from "../prefetchCardMedia";

class StubImage {
  static created: StubImage[] = [];
  decoding?: string;
  src = "";

  constructor() {
    StubImage.created.push(this);
  }
}

const originalImage = globalThis.Image;
const url = (name: string) => `https://files.example.com/${name}`;
let prefetchCardModalMedia = createMediaPrefetcher();

beforeEach(() => {
  prefetchCardModalMedia = createMediaPrefetcher();
  StubImage.created.length = 0;
  globalThis.Image = StubImage as unknown as typeof Image;
});

afterEach(() => {
  globalThis.Image = originalImage;
});

describe("lib/prefetchCardMedia", () => {
  test("warms the image modal's detail rendition once per url", () => {
    const card = {
      detailUrl: url("detail.webp"),
      fileUrl: url("original.jpg"),
      thumbnailUrl: url("thumb.webp"),
      type: "image",
    };

    prefetchCardModalMedia(card);
    prefetchCardModalMedia(card);

    expect(StubImage.created.map((image) => image.src)).toEqual([
      card.detailUrl,
    ]);
  });

  test("falls back to the thumbnail when an image has no detail rendition", () => {
    const thumbnailUrl = url("thumb.webp");

    prefetchCardModalMedia({
      fileUrl: url("original.jpg"),
      thumbnailUrl,
      type: "image",
    });

    expect(StubImage.created.map((image) => image.src)).toEqual([thumbnailUrl]);
  });

  test("warms only the poster for video cards and ignores other types", () => {
    const posterUrl = url("poster.webp");

    prefetchCardModalMedia({
      fileUrl: url("clip.mp4"),
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
