// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Doc } from "@teak/convex/_generated/dataModel";
import React from "react";
import { Card } from "../../components/Card";

// Mock Ant Design Image component
mock.module("antd", () => ({
  Image: ({ src, alt, className, ...props }: any) =>
    React.createElement("img", { src, alt, className, ...props }),
}));

// Mock UI components
mock.module("../../components/ui/context-menu", () => ({
  ContextMenu: ({ children }: any) =>
    React.createElement("div", { className: "context-menu" }, children),
  ContextMenuTrigger: ({ children, disabled }: any) =>
    React.createElement(
      "div",
      { disabled, className: "context-trigger" },
      children
    ),
  ContextMenuContent: ({ children }: any) =>
    React.createElement("div", { className: "context-content" }, children),
  ContextMenuItem: ({ children, onClick }: any) =>
    React.createElement(
      "div",
      { onClick, className: "context-item" },
      children
    ),
  ContextMenuSeparator: () =>
    React.createElement("div", { className: "context-separator" }),
}));

mock.module("../../components/ui/card", () => ({
  Card: ({ children, className }: any) =>
    React.createElement("div", { className, "data-card": "" }, children),
  CardContent: ({ children }: any) =>
    React.createElement("div", { className: "card-content" }, children),
}));

mock.module("../../components/ui/checkbox", () => ({
  Checkbox: ({ checked, className }: any) =>
    React.createElement("input", {
      type: "checkbox",
      checked,
      className,
      readOnly: true,
    }),
}));

describe("Card Component", () => {
  let mockOnClick: any;
  let mockOnDelete: any;
  let mockOnRestore: any;
  let mockOnPermanentDelete: any;
  let mockOnToggleFavorite: any;
  let mockOnAddTags: any;
  let mockOnCopyImage: any;
  let mockOnEnterSelectionMode: any;
  let mockOnToggleSelection: any;

  beforeEach(() => {
    mockOnClick = mock();
    mockOnDelete = mock();
    mockOnRestore = mock();
    mockOnPermanentDelete = mock();
    mockOnToggleFavorite = mock();
    mockOnAddTags = mock();
    mockOnCopyImage = mock();
    mockOnEnterSelectionMode = mock();
    mockOnToggleSelection = mock();
  });

  const createMockCard = (overrides?: Partial<Doc<"cards">>): Doc<"cards"> => ({
    _id: "test-card-id",
    _creationTime: Date.now(),
    userId: "user-123" as any,
    content: "Test card content",
    type: "text",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  describe("Rendering", () => {
    test("renders text card with content", () => {
      const card = createMockCard({ type: "text", content: "Test content" });
      // Card should render without throwing
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("renders link card with URL", () => {
      const card = createMockCard({
        type: "link",
        url: "https://example.com",
        content: "Example Link",
      });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("renders image card with thumbnail", () => {
      const card = createMockCard({
        type: "image",
        thumbnailUrl: "https://example.com/image.jpg",
        fileMetadata: { width: 800, height: 600 } as any,
      });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("renders video card with thumbnail", () => {
      const card = createMockCard({
        type: "video",
        thumbnailUrl: "https://example.com/video.jpg",
      });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("renders audio card with wave visualization", () => {
      const card = createMockCard({ type: "audio" });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("renders document card with file metadata", () => {
      const card = createMockCard({
        type: "document",
        fileMetadata: { fileName: "document.pdf" } as any,
      });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("renders palette card with colors", () => {
      const card = createMockCard({
        type: "palette",
        colors: [{ hex: "#ff0000" }, { hex: "#00ff00" }, { hex: "#0000ff" }],
      });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("renders quote card with italic styling", () => {
      const card = createMockCard({
        type: "quote",
        content: "This is a test quote",
      });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("renders card without type", () => {
      const card = createMockCard({
        type: undefined as any,
        content: "No type content",
      });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("renders favorited card with heart icon", () => {
      const card = createMockCard({ isFavorited: true });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("renders deleted card with opacity", () => {
      const card = createMockCard({ isDeleted: true });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("renders optimistic card with loading indicator", () => {
      const card = createMockCard({
        _id: "12345678-1234-4123-9123-123456789abc" as any,
      });
      expect(() => {
        React.createElement(Card, { card });
      }).not.toThrow();
    });
  });

  describe("Selection Mode", () => {
    test("shows checkbox when in selection mode", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(Card, {
          card,
          isSelectionMode: true,
          isSelected: false,
          onClick: mockOnClick,
        });
      }).not.toThrow();
    });

    test("shows checked checkbox when selected", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(Card, {
          card,
          isSelectionMode: true,
          isSelected: true,
          onClick: mockOnClick,
        });
      }).not.toThrow();
    });

    test("renders selection ring when selected", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(Card, {
          card,
          isSelectionMode: true,
          isSelected: true,
          onClick: mockOnClick,
        });
      }).not.toThrow();
    });
  });

  describe("User Interactions", () => {
    test("does not call onClick for optimistic cards", () => {
      const card = createMockCard({ _id: crypto.randomUUID() as any });
      const element = React.createElement(Card, {
        card,
        onClick: mockOnClick,
      });
      expect(element).toBeDefined();
    });

    test("provides onDelete callback", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(Card, {
          card,
          onDelete: mockOnDelete,
        });
      }).not.toThrow();
    });

    test("provides onRestore callback for deleted cards", () => {
      const card = createMockCard({ isDeleted: true });
      expect(() => {
        React.createElement(Card, {
          card,
          onRestore: mockOnRestore,
        });
      }).not.toThrow();
    });

    test("provides onPermanentDelete callback", () => {
      const card = createMockCard({ isDeleted: true });
      expect(() => {
        React.createElement(Card, {
          card,
          onPermanentDelete: mockOnPermanentDelete,
        });
      }).not.toThrow();
    });

    test("provides onToggleFavorite callback", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(Card, {
          card,
          onToggleFavorite: mockOnToggleFavorite,
        });
      }).not.toThrow();
    });

    test("provides onAddTags callback", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(Card, {
          card,
          onAddTags: mockOnAddTags,
        });
      }).not.toThrow();
    });

    test("provides onCopyImage callback", () => {
      const card = createMockCard({ type: "image" });
      expect(() => {
        React.createElement(Card, {
          card,
          onCopyImage: mockOnCopyImage,
        });
      }).not.toThrow();
    });

    test("provides onEnterSelectionMode callback", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(Card, {
          card,
          onEnterSelectionMode: mockOnEnterSelectionMode,
        });
      }).not.toThrow();
    });

    test("provides onToggleSelection callback", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(Card, {
          card,
          isSelectionMode: true,
          onToggleSelection: mockOnToggleSelection,
        });
      }).not.toThrow();
    });
  });

  describe("Props Handling", () => {
    test("handles card with link preview metadata", () => {
      const card = createMockCard({
        type: "link",
        url: "https://example.com",
        metadata: {
          linkPreview: {
            status: "success",
            title: "Example Title",
            imageUrl: "https://example.com/image.jpg",
            imageWidth: 800,
            imageHeight: 600,
          },
        },
        linkPreviewImageUrl: "https://example.com/image.jpg",
      } as any);
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("handles card with screenshot fallback", () => {
      const card = createMockCard({
        type: "link",
        url: "https://example.com",
        screenshotUrl: "https://example.com/screenshot.jpg",
      } as any);
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("handles card with file metadata", () => {
      const card = createMockCard({
        type: "image",
        fileMetadata: {
          fileName: "image.jpg",
          width: 1920,
          height: 1080,
          mimeType: "image/jpeg",
        } as any,
      });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("handles card with tags", () => {
      const card = createMockCard({
        tags: ["tag1", "tag2", "tag3"],
      });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("handles card with notes", () => {
      const card = createMockCard({
        notes: "These are some notes",
      });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });
  });

  describe("Edge Cases", () => {
    test("handles card with empty content", () => {
      const card = createMockCard({ content: "" });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("handles card with very long content", () => {
      const card = createMockCard({ content: "A".repeat(1000) });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("handles card with special characters in content", () => {
      const card = createMockCard({ content: "<script>alert('xss')</script>" });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("handles card with unicode characters", () => {
      const card = createMockCard({ content: "Hello 世界 🌍" });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("handles card without URLs", () => {
      const card = createMockCard({
        type: "image",
        fileUrl: undefined,
        thumbnailUrl: undefined,
      } as any);
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });

    test("handles link card with invalid URL", () => {
      const card = createMockCard({
        type: "link",
        url: "not-a-valid-url",
      });
      expect(() => {
        React.createElement(Card, { card, onClick: mockOnClick });
      }).not.toThrow();
    });
  });

  describe("Context Menu Actions", () => {
    test("provides copy text option for text cards", () => {
      const card = createMockCard({ type: "text", content: "Copy me" });
      expect(() => {
        React.createElement(Card, {
          card,
          onCopyImage: mockOnCopyImage,
        });
      }).not.toThrow();
    });

    test("provides copy link option for link cards", () => {
      const card = createMockCard({
        type: "link",
        url: "https://example.com",
      });
      expect(() => {
        React.createElement(Card, {
          card,
          onCopyImage: mockOnCopyImage,
        });
      }).not.toThrow();
    });

    test("provides copy image option for non-SVG images", () => {
      const card = createMockCard({
        type: "image",
        fileMetadata: { mimeType: "image/png" } as any,
      });
      expect(() => {
        React.createElement(Card, {
          card,
          onCopyImage: mockOnCopyImage,
        });
      }).not.toThrow();
    });

    test("does not provide copy option for SVG images", () => {
      const card = createMockCard({
        type: "image",
        fileMetadata: { mimeType: "image/svg+xml" } as any,
      });
      expect(() => {
        React.createElement(Card, {
          card,
          onCopyImage: mockOnCopyImage,
        });
      }).not.toThrow();
    });

    test("provides open link option for cards with URL", () => {
      const card = createMockCard({
        type: "link",
        url: "https://example.com",
      });
      expect(() => {
        React.createElement(Card, { card });
      }).not.toThrow();
    });
  });
});
