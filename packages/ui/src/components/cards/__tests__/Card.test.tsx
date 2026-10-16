import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// NOTE: bun:test's mock.module() registrations leak across test files that run
// in the same `bun test` process. Every factory below spreads the real module
// so a leaked mock still exposes the full export surface.
const realTeakConvex = await import("@teak/convex");
const realConvexReact = await import("convex/react");
const realCardUi = await import("@teak/ui/components/ui/card");

const cardApi = {
  card: { getFileUrl: { refreshCardMediaUrl: {} } },
  cards: { reprocessCard: {} },
};
mock.module("@teak/convex", () => ({
  ...realTeakConvex,
  // `api` is a path-dynamic proxy that cannot be spread; fall back to the real
  // proxy for paths this test does not stub.
  api: new Proxy(cardApi, {
    get: (target, prop, receiver) =>
      typeof prop === "string" && !(prop in target)
        ? (realTeakConvex.api as any)[prop]
        : Reflect.get(target, prop, receiver),
  }),
}));

mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
  useMutation: () => mock(),
}));

mock.module("antd", () => ({
  Image: ({ src, alt, className, ...props }: any) =>
    React.createElement("img", { src, alt, className, ...props }),
}));

mock.module("@teak/ui/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: any) =>
    React.createElement("div", { className: "context-menu" }, children),
  ContextMenuTrigger: ({ children, disabled }: any) =>
    React.createElement(
      "div",
      { className: "context-trigger", disabled },
      children
    ),
  ContextMenuContent: ({ children }: any) =>
    React.createElement("div", { className: "context-content" }, children),
  ContextMenuItem: ({ children, "aria-keyshortcuts": keys }: any) =>
    React.createElement(
      "div",
      {
        "aria-keyshortcuts": keys,
        className: "context-item",
        role: "menuitem",
      },
      children
    ),
  ContextMenuSeparator: () =>
    React.createElement("div", { className: "context-separator" }),
  ContextMenuShortcut: ({ children }: any) =>
    React.createElement("kbd", null, children),
}));

mock.module("@teak/ui/components/ui/card", () => ({
  ...realCardUi,
  Card: ({ children, className }: any) =>
    React.createElement("div", { className, "data-card": "" }, children),
  CardContent: ({ children }: any) =>
    React.createElement("div", { className: "card-content" }, children),
}));

mock.module("@teak/ui/components/ui/checkbox", () => ({
  Checkbox: ({ checked, className }: any) =>
    React.createElement("input", {
      type: "checkbox",
      checked,
      className,
      readOnly: true,
    }),
}));

mock.module("../previews/GridDocumentPreview", () => ({
  GridDocumentPreview: () => React.createElement("div"),
}));

mock.module("../previews/GridImagePreview", () => ({
  GridImagePreview: () => React.createElement("div"),
}));

mock.module("../previews/GridVideoPreview", () => ({
  GridVideoPreview: (props: Record<string, unknown>) =>
    React.createElement("div", {
      "data-video-props": JSON.stringify({
        scrub: props.scrub,
        scrubKey: props.scrubKey,
        scrubUrl: props.scrubUrl,
      }),
    }),
}));

const { Card, resolveImageCopyUrl } = await import("../Card");

const createLinkCard = (overrides?: Record<string, unknown>) => ({
  _id: "card_123",
  _creationTime: Date.now(),
  userId: "user_123",
  content: "Link card",
  type: "link",
  url: "https://x.com/teak/status/123",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe("Cards/Card", () => {
  test("mints the original image URL only when copying", async () => {
    const refresh = mock().mockResolvedValue({
      url: "https://files.teakvault.com/original.jpg",
    });
    await expect(
      resolveImageCopyUrl({
        cardId: "card_123",
        fallbackUrl: "https://files.teakvault.com/grid.jpg",
        fileKey: "original-key",
        refresh,
      })
    ).resolves.toBe("https://files.teakvault.com/original.jpg");
    expect(refresh).toHaveBeenCalledWith({
      cardId: "card_123",
      key: "original-key",
    });
  });

  test("does not substitute a preview if refreshing the original URL fails", async () => {
    await expect(
      resolveImageCopyUrl({
        cardId: "card_123",
        fallbackUrl: "https://files.teakvault.com/grid.jpg",
        fileKey: "original-key",
        refresh: mock().mockRejectedValue(new Error("refresh failed")),
      })
    ).rejects.toThrow("refresh failed");
  });

  test("its menu shows the key for each action a key also does", () => {
    const markup = renderToStaticMarkup(
      <Card card={createLinkCard() as any} onToggleArchive={() => undefined} />
    );
    for (const [label, key] of [
      ["Add Tags", "T"],
      ["Archive", "E"],
      ["Favorite", "F"],
      ["Select", "X"],
    ]) {
      expect(markup).toContain(`${label}<kbd>${key}</kbd>`);
      expect(markup).toContain(`aria-keyshortcuts="${key}"`);
    }
    expect(markup).toMatch(/Copy Link<kbd>(⌘C|Ctrl\+C)<\/kbd>/);
    expect(markup).toMatch(/Delete<kbd>(⌫|Del)<\/kbd>/);
    expect(markup).toContain("Open Link</div>");
    expect(markup).toContain("Refresh details</div>");
  });

  test("in selection mode, its menu shows only keys that act on this card", () => {
    const markup = renderToStaticMarkup(
      <Card
        card={createLinkCard() as any}
        isSelected
        isSelectionMode
        onToggleArchive={() => undefined}
      />
    );
    expect(markup).toContain("Deselect<kbd>X</kbd>");
    expect(markup).toMatch(/Copy Link<kbd>(⌘C|Ctrl\+C)<\/kbd>/);
    for (const label of ["Add Tags", "Favorite", "Archive", "Delete"]) {
      expect(markup).toContain(`${label}</div>`);
    }
    expect(markup).not.toContain('aria-keyshortcuts="F"');
  });

  test("offers Refresh details for an active card but not for one in Trash", () => {
    const active = renderToStaticMarkup(
      <Card card={createLinkCard() as any} />
    );
    expect(active).toContain("Refresh details");

    const trashed = renderToStaticMarkup(
      <Card card={createLinkCard({ isDeleted: true }) as any} />
    );
    expect(trashed).not.toContain("Refresh details");
    expect(trashed).toContain("Restore");
  });

  test("prefers attached X image media over screenshot in masonry preview", () => {
    const markup = renderToStaticMarkup(
      <Card
        card={
          createLinkCard({
            screenshotUrl: "https://example.com/screenshot.jpg",
            metadata: {
              linkPreview: {
                status: "success",
                title: "Post with images",
                screenshotWidth: 800,
                screenshotHeight: 600,
              },
            },
            linkPreviewMedia: [
              {
                type: "image",
                url: "https://example.com/attached-image.jpg",
                width: 1200,
                height: 900,
              },
            ],
          }) as any
        }
      />
    );

    expect(markup).toContain("attached-image.jpg");
    expect(markup).not.toContain("screenshot.jpg");
  });

  test("shows a chosen image before attached X image media", () => {
    const markup = renderToStaticMarkup(
      <Card
        card={
          createLinkCard({
            hasThumbnailOverride: true,
            linkPreviewImageUrl: "https://example.com/chosen.jpg",
            metadata: {
              linkPreview: { status: "success", title: "Post with images" },
            },
            linkPreviewMedia: [
              {
                type: "image",
                url: "https://example.com/attached-image.jpg",
                width: 1200,
                height: 900,
              },
            ],
            thumbnailOverride: {
              height: 900,
              storageKey: "users/u/cards/c/thumbnail-override/chosen",
              width: 600,
            },
          }) as any
        }
      />
    );

    expect(markup).toContain("chosen.jpg");
    expect(markup).not.toContain("attached-image.jpg");
  });

  test("prefers attached X video poster over screenshot in masonry preview", () => {
    const markup = renderToStaticMarkup(
      <Card
        card={
          createLinkCard({
            screenshotUrl: "https://example.com/screenshot.jpg",
            metadata: {
              linkPreview: {
                status: "success",
                title: "Post with video",
                screenshotWidth: 800,
                screenshotHeight: 600,
              },
            },
            linkPreviewMedia: [
              {
                type: "video",
                url: "https://example.com/video.mp4",
                posterUrl: "https://example.com/video-poster.jpg",
                posterWidth: 1280,
                posterHeight: 720,
              },
            ],
          }) as any
        }
      />
    );

    expect(markup).toContain("video-poster.jpg");
    expect(markup).not.toContain("screenshot.jpg");
  });

  test("passes scrub data from the card to the video preview", () => {
    const scrub = { frames: 12, frameHeight: 90, frameWidth: 160 };
    const markup = renderToStaticMarkup(
      <Card
        card={
          createLinkCard({
            type: "video",
            fileUrl: "https://example.com/clip.mp4",
            fileMetadata: { scrub },
            scrubKey: "scrub-key",
            scrubUrl: "https://example.com/scrub.jpg",
          }) as any
        }
      />
    );
    const props = JSON.parse(
      /data-video-props="([^"]*)"/
        .exec(markup)?.[1]
        ?.replaceAll("&quot;", '"') ?? "null"
    );

    expect(props).toEqual({
      scrub,
      scrubKey: "scrub-key",
      scrubUrl: "https://example.com/scrub.jpg",
    });
  });

  test("passes the waveform grid from the card to the audio preview", () => {
    const grid = Array.from({ length: 45 }, () => 100);
    const markup = renderToStaticMarkup(
      <Card
        card={
          createLinkCard({
            type: "audio",
            fileMetadata: { waveform: { detail: [], grid } },
          }) as any
        }
      />
    );

    expect((markup.match(/height:100%/g) ?? []).length).toBe(45);
  });
});

describe("Cards/Card redesign", () => {
  const linkWithPreview = (overrides?: Record<string, unknown>) =>
    createLinkCard({
      url: "https://www.example.com/story",
      metadata: {
        linkPreview: {
          status: "success",
          title: "A story worth keeping",
          imageWidth: 1200,
          imageHeight: 630,
        },
      },
      linkPreviewImageUrl: "https://example.com/og.jpg",
      ...overrides,
    });

  test("names a link by its favicon and title, without spelling out the site", () => {
    const markup = renderToStaticMarkup(
      <Card card={linkWithPreview() as any} />
    );
    expect(markup).toContain("A story worth keeping");
    expect(markup).toContain("domain=example.com");
    expect(markup).not.toContain(">example.com<");
  });

  const pricedLink = (
    price: { amount: number; currency?: string } | undefined,
    withImage = true
  ) =>
    linkWithPreview({
      metadata: {
        linkPreview: {
          status: "success",
          title: "Desk lamp",
          ...(withImage ? { imageWidth: 1200, imageHeight: 630 } : {}),
        },
        linkCategory: {
          category: "product",
          fetchedAt: 1,
          sourceUrl: "https://www.example.com/story",
          ...(price ? { price } : {}),
        },
      },
      ...(withImage ? {} : { linkPreviewImageUrl: undefined }),
    });

  test.each([
    [{ amount: 24.99, currency: "USD" }, "$24.99"],
    [{ amount: 1299, currency: "EUR" }, "€1,299.00"],
    [{ amount: 1_299_999, currency: "JPY" }, "¥1,299,999"],
    [{ amount: 0, currency: "USD" }, "Free"],
    [{ amount: 12.5 }, "12.5"],
    [{ amount: 7, currency: "NOTACODE" }, "7"],
  ])("tags a product tile's image with its price %#", (price, label) => {
    const markup = renderToStaticMarkup(
      <Card card={pricedLink(price) as any} />
    );
    expect(markup).toContain(`>${label}</span>`);
  });

  test("shows no price tag on a link without a price", () => {
    const markup = renderToStaticMarkup(
      <Card card={pricedLink(undefined) as any} />
    );
    expect(markup).toContain("Desk lamp");
    expect(markup).not.toContain("$");
    expect(markup).not.toContain("Free");
  });

  test("puts the price beside the title when the tile has no image", () => {
    const markup = renderToStaticMarkup(
      <Card
        card={pricedLink({ amount: 24.99, currency: "USD" }, false) as any}
      />
    );
    expect(markup).not.toContain("og.jpg");
    expect(markup).toMatch(/Desk lamp<\/p><span[^>]*>\$24\.99<\/span>/);
  });

  test("offers open, favorite and more actions on an active card", () => {
    const markup = renderToStaticMarkup(
      <Card
        card={linkWithPreview() as any}
        onEnterSelectionMode={() => undefined}
      />
    );
    expect(markup).toContain('aria-label="Open link"');
    expect(markup).toContain('aria-label="Favorite"');
    expect(markup).toContain('aria-label="More actions"');
    expect(markup).toContain('aria-label="Select"');
  });

  test("leaves only More actions on a card in Trash", () => {
    const markup = renderToStaticMarkup(
      <Card
        card={linkWithPreview({ isDeleted: true }) as any}
        onEnterSelectionMode={() => undefined}
      />
    );
    expect(markup).toContain('aria-label="More actions"');
    expect(markup).not.toContain('aria-label="Favorite"');
    expect(markup).not.toContain('aria-label="Open link"');
    expect(markup).not.toContain('aria-label="Select"');
  });

  test("hides the hover actions while selecting cards", () => {
    const markup = renderToStaticMarkup(
      <Card card={linkWithPreview() as any} isSelectionMode />
    );
    expect(markup).not.toContain('aria-label="More actions"');
    expect(markup).not.toContain('aria-label="Favorite"');
  });

  test("marks a favorite and offers to unfavorite it", () => {
    const markup = renderToStaticMarkup(
      <Card card={linkWithPreview({ isFavorited: true }) as any} />
    );
    expect(markup).toContain('aria-label="Unfavorite"');
    expect(markup).toContain('aria-pressed="true"');
  });

  test("shows a note's first line as its heading and the rest below", () => {
    const markup = renderToStaticMarkup(
      <Card
        card={
          createLinkCard({
            type: "text",
            url: undefined,
            content: "Groceries\n\nOat milk, lemons, basil",
          }) as any
        }
      />
    );
    expect(markup).toContain(">Groceries<");
    expect(markup).toContain(">Oat milk, lemons, basil<");
  });

  test("names an audio card's recording and its length", () => {
    const markup = renderToStaticMarkup(
      <Card
        card={
          createLinkCard({
            type: "audio",
            url: undefined,
            fileMetadata: { fileName: "Standup.m4a", duration: 84 },
          }) as any
        }
      />
    );
    expect(markup).toContain("Standup.m4a");
    expect(markup).toContain("1:24");
  });

  test("shows a text-only social post with its author", () => {
    const markup = renderToStaticMarkup(
      <Card
        card={
          createLinkCard({
            url: "https://mastodon.social/@Gargron/109311046116149744",
            metadata: {
              linkPreview: {
                status: "success",
                title: "It was the butler and the cook.",
                description:
                  "Eugen Rochko (@Gargron@mastodon.social) on Mastodon · November 9, 2022",
                author: "Eugen Rochko",
                siteName: "Mastodon",
                categoryHint: "social_post",
              },
            },
          }) as any
        }
      />
    );
    expect(markup).toContain(">It was the butler and the cook.<");
    expect(markup).toContain("Eugen Rochko (@Gargron@mastodon.social)");
  });
});
