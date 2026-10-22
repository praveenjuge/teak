import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

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

  // Bug 17: the words typed around a URL were saved but never shown.
  test("shows the words saved with the link, outside the link itself", () => {
    const markup = renderToStaticMarkup(
      <LinkPreview
        card={
          createLinkCard({
            content:
              "Ask Sam about (https://x.com/teak/status/123) &amp; reply",
          }) as any
        }
      />
    );
    expect(markup).toContain(">Ask Sam about &amp; reply</p>");
    expect(markup.indexOf("Ask Sam")).toBeGreaterThan(markup.indexOf("</a>"));
  });

  test("shows no note for a link saved on its own", () => {
    const markup = renderToStaticMarkup(
      <LinkPreview
        card={
          createLinkCard({ content: "https://x.com/teak/status/123" }) as any
        }
      />
    );
    expect(markup).not.toContain("https://x.com/teak/status/123</p>");
    expect(markup.match(/<p /g)).toHaveLength(1);
  });

  test("shows who wrote the page and when beside the site", () => {
    const markup = renderToStaticMarkup(
      <LinkPreview
        card={
          createLinkCard({
            url: "https://www.theverge.com/2024/3/5/story",
            metadata: {
              linkPreview: {
                status: "success",
                title: "A story",
                author: "Jane Doe",
                publisher: "The Verge",
                publishedAt: "2024-03-05T10:00:00Z",
              },
            },
          }) as any
        }
      />
    );

    expect(markup).toContain(">theverge.com<");
    expect(markup).toContain(">By Jane Doe · Mar 5, 2024<");
  });

  test("leaves the byline out when the page has no author or date", () => {
    const markup = renderToStaticMarkup(
      <LinkPreview card={createLinkCard() as any} />
    );
    expect(markup).not.toContain("By ");
    expect(markup).not.toContain("·");
  });

  test("ignores author data from a failed preview fetch", () => {
    const markup = renderToStaticMarkup(
      <LinkPreview
        card={
          createLinkCard({
            metadata: {
              linkPreview: { status: "error", author: "Stale Author" },
            },
          }) as any
        }
      />
    );
    expect(markup).not.toContain("Stale Author");
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

describe("LinkPreview in the card dialog", () => {
  const thumbnail = { onFile: () => undefined };

  test("offers a place to drop an image when the link has none", () => {
    const markup = renderToStaticMarkup(
      <LinkPreview card={createLinkCard() as any} thumbnail={thumbnail} />
    );
    expect(markup).toContain("Add an image");
    expect(markup.indexOf("Add an image")).toBeLessThan(markup.indexOf("<a "));
  });

  test("shows no drop area where the image can't change, or once there is one", () => {
    expect(
      renderToStaticMarkup(<LinkPreview card={createLinkCard() as any} />)
    ).not.toContain("Add an image");
    expect(
      renderToStaticMarkup(
        <LinkPreview
          card={
            createLinkCard({
              linkPreviewImageUrl: "https://cdn.example.com/og.png",
            }) as any
          }
          thumbnail={thumbnail}
        />
      )
    ).not.toContain("Add an image");
  });

  test("shows the file being uploaded in place of the image", () => {
    const markup = renderToStaticMarkup(
      <LinkPreview
        card={
          createLinkCard({
            linkPreviewImageUrl: "https://cdn.example.com/og.png",
          }) as any
        }
        thumbnail={{ ...thumbnail, uploadingPreviewUrl: "blob:local-file" }}
      />
    );
    expect(markup).toContain('src="blob:local-file"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("og.png");
  });
});
