import { describe, expect, test } from "bun:test";
import { ImagePreview } from "@teak/ui/card-previews";
import { renderToStaticMarkup } from "react-dom/server";

const createImageCard = (overrides?: Record<string, unknown>) => ({
  _id: "card_123",
  _creationTime: Date.now(),
  content: "Image card",
  createdAt: Date.now(),
  fileMetadata: {
    height: 2400,
    width: 800,
  },
  fileUrl: "https://example.com/tall-image.jpg",
  isDeleted: false,
  isFavorited: false,
  tags: [],
  type: "image",
  updatedAt: Date.now(),
  userId: "user_123",
  ...overrides,
});

describe("ImagePreview", () => {
  test("renders tall images full width so the modal can scroll vertically", () => {
    const markup = renderToStaticMarkup(
      <ImagePreview card={createImageCard() as any} />
    );

    expect(markup).toContain('data-fit="width"');
    expect(markup).not.toContain('data-fit="contain"');
  });

  test("fits standard images inside the dialog", () => {
    const markup = renderToStaticMarkup(
      <ImagePreview
        card={
          createImageCard({
            fileMetadata: {
              height: 900,
              width: 1600,
            },
            fileUrl: "https://example.com/landscape-image.jpg",
          }) as any
        }
      />
    );

    expect(markup).toContain('data-fit="contain"');
    expect(markup).not.toContain('data-fit="width"');
  });

  test("does not render the legacy in-preview palette overlay", () => {
    const markup = renderToStaticMarkup(
      <ImagePreview
        card={
          createImageCard({
            colors: [{ hex: "#112233" }, { hex: "#445566" }],
          }) as any
        }
      />
    );

    expect(markup).not.toContain("absolute bottom-4 left-3");
    expect(markup).not.toContain('title="#112233"');
  });
});
