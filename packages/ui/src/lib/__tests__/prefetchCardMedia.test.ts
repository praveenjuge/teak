import { describe, expect, test } from "bun:test";
import { prefetchCardModalMedia } from "../prefetchCardMedia";

class StubImage {
  static created: StubImage[] = [];
  decoding?: string;
  src = "";

  constructor() {
    StubImage.created.push(this);
  }
}

describe("lib/prefetchCardMedia", () => {
  test("warms image cards once per url", () => {
    const originalImage = globalThis.Image;
    globalThis.Image = StubImage as unknown as typeof Image;
    try {
      const card = {
        fileUrl: "https://files.example.com/original.jpg",
        thumbnailUrl: "https://files.example.com/thumb.webp",
        type: "image",
      };
      prefetchCardModalMedia(card);
      prefetchCardModalMedia(card);

      expect(StubImage.created).toHaveLength(1);
      expect(StubImage.created[0]!.src).toBe(card.fileUrl);
    } finally {
      globalThis.Image = originalImage;
    }
  });

  test("warms only the poster for video cards and ignores other types", () => {
    const originalImage = globalThis.Image;
    globalThis.Image = StubImage as unknown as typeof Image;
    StubImage.created.length = 0;
    try {
      prefetchCardModalMedia({
        fileUrl: "https://files.example.com/clip.mp4",
        thumbnailUrl: "https://files.example.com/poster.webp",
        type: "video",
      });
      prefetchCardModalMedia({
        content: "just text",
        type: "text",
      });

      expect(StubImage.created).toHaveLength(1);
      expect(StubImage.created[0]!.src).toBe(
        "https://files.example.com/poster.webp"
      );
    } finally {
      globalThis.Image = originalImage;
    }
  });
});
