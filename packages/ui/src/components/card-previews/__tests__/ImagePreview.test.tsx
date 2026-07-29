import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImagePreview } from "../ImagePreview";

const createImageCard = (overrides?: Record<string, unknown>) => ({
  _id: "card_image",
  _creationTime: Date.now(),
  content: "Moodboard",
  createdAt: Date.now(),
  isDeleted: false,
  isFavorited: false,
  type: "image",
  updatedAt: Date.now(),
  userId: "user_123",
  ...overrides,
});

describe("ImagePreview", () => {
  test("shows a fallback when no image URL is available", () => {
    const markup = renderToStaticMarkup(
      <ImagePreview
        card={
          createImageCard({
            fileMetadata: { fileName: "shot.png" },
          }) as any
        }
      />
    );

    expect(markup).toContain("shot.png");
  });

  test("renders the file URL for standard images", () => {
    const markup = renderToStaticMarkup(
      <ImagePreview
        card={
          createImageCard({
            fileUrl: "https://cdn.example.com/photo.jpg",
            fileMetadata: { width: 1200, height: 800, fileName: "photo.jpg" },
          }) as any
        }
      />
    );

    expect(markup).toContain("photo.jpg");
    expect(markup).toContain("max-h-[75vh]");
  });

  test("uses thumbnail derivatives for HEIC and tall-image layout", () => {
    const markup = renderToStaticMarkup(
      <ImagePreview
        card={
          createImageCard({
            fileUrl: "https://cdn.example.com/original.heic",
            thumbnailUrl: "https://cdn.example.com/thumb.jpg",
            fileMetadata: {
              fileName: "original.heic",
              mimeType: "image/heic",
              width: 800,
              height: 1600,
            },
          }) as any
        }
      />
    );

    expect(markup).toContain("thumb.jpg");
    expect(markup).toContain("min-h-full");
    expect(markup).not.toContain("original.heic");
  });
});
