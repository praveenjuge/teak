import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// The preview image refreshes expired URLs through a Convex action; spread the
// real module because bun:test module mocks leak across files.
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
}));

const { LinkPreview } = await import("../LinkPreview");

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
  test("shows the title, site, and description linking to the saved URL", () => {
    const markup = renderToStaticMarkup(
      <LinkPreview
        card={
          createLinkCard({
            url: "https://www.example.com/articles/type?ref=feed",
            linkPreviewImageUrl: "https://cdn.example.com/og.png",
          }) as any
        }
      />
    );

    expect(markup).toContain("Teak on X");
    expect(markup).toContain(">example.com<");
    expect(markup).toContain("A saved post");
    expect(markup).toContain('src="https://cdn.example.com/og.png"');
    expect(markup).toContain(
      'href="https://www.example.com/articles/type?ref=feed"'
    );
  });

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
