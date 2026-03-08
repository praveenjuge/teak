import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LinkPreview } from "../LinkPreview";

const createLinkCard = (overrides?: Record<string, unknown>) => ({
  _id: "card_123",
  _creationTime: Date.now(),
  content: "Link card",
  createdAt: Date.now(),
  isDeleted: false,
  isFavorited: false,
  metadata: {
    linkPreview: {
      status: "success",
      title: "Teak on X",
      description: "A saved post",
    },
  },
  type: "link",
  updatedAt: Date.now(),
  url: "https://x.com/teak/status/123",
  userId: "user_123",
  ...overrides,
});

describe("LinkPreview", () => {
  test("renders attached post images one below another", () => {
    const markup = renderToStaticMarkup(
      <LinkPreview
        card={
          createLinkCard({
            linkPreviewMedia: [
              {
                type: "image",
                url: "https://cdn.example.com/image-1.jpg",
                width: 1200,
                height: 900,
              },
              {
                type: "image",
                url: "https://cdn.example.com/image-2.jpg",
                width: 1200,
                height: 900,
              },
            ],
          }) as any
        }
      />
    );

    expect(markup).toContain("Attached post media 1");
    expect(markup).toContain("Attached post media 2");
    expect((markup.match(/Attached post media/g) ?? []).length).toBe(2);
    expect(markup).toContain("flex flex-col gap-4");
  });

  test("renders attached video with controls below the preview", () => {
    const markup = renderToStaticMarkup(
      <LinkPreview
        card={
          createLinkCard({
            linkPreviewMedia: [
              {
                type: "video",
                url: "https://cdn.example.com/post.mp4",
                contentType: "video/mp4",
                posterUrl: "https://cdn.example.com/poster.jpg",
              },
            ],
          }) as any
        }
      />
    );

    expect(markup).toContain("<video");
    expect(markup).toContain("controls");
    expect(markup).toContain("post.mp4");
    expect(markup).toContain("poster.jpg");
  });
});
