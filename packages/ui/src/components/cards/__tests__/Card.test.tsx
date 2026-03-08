import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
  ContextMenuItem: ({ children }: any) =>
    React.createElement("div", { className: "context-item" }, children),
  ContextMenuSeparator: () =>
    React.createElement("div", { className: "context-separator" }),
}));

mock.module("@teak/ui/components/ui/card", () => ({
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

mock.module("../previews/AudioWavePreview", () => ({
  AudioWavePreview: () => React.createElement("div"),
}));

mock.module("../previews/GridDocumentPreview", () => ({
  GridDocumentPreview: () => React.createElement("div"),
}));

mock.module("../previews/GridImagePreview", () => ({
  GridImagePreview: () => React.createElement("div"),
}));

mock.module("../previews/GridVideoPreview", () => ({
  GridVideoPreview: () => React.createElement("div"),
}));

const { Card } = await import("../Card");

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
});
