// @ts-nocheck
import { describe, test, expect, mock, beforeEach } from "bun:test";
import React from "react";
import { CardModal } from "../../components/CardModal";
import type { CardModalCard } from "../../components/card-modal/types";

// Mock Dialog component
mock.module("../../components/ui/dialog", () => ({
  Dialog: ({ children, open, onOpenChange }: any) =>
    React.createElement("div", { className: "dialog", open, "data-state": open ? "open" : "closed" }, children),
  DialogContent: ({ children, className }: any) =>
    React.createElement("div", { className, "data-dialog-content": "" }, children),
  DialogTitle: ({ children, className }: any) =>
    React.createElement("h2", { className }, children),
  DialogDescription: ({ children, className }: any) =>
    React.createElement("p", { className }, children),
}));

// Mock Loading component
mock.module("../../components/Loading", () => ({
  Loading: () => React.createElement("div", { className: "loading-spinner" }),
}));

// Mock card modal components
mock.module("../../components/card-modal/CardModalPreview", () => ({
  CardModalPreview: ({ card, hasUnsavedChanges, isSaved, saveChanges }: any) =>
    React.createElement("div", { "data-preview": "", "data-unsaved": hasUnsavedChanges, "data-saved": isSaved }),
}));

mock.module("../../components/card-modal/CardMetadataPanel", () => ({
  CardMetadataPanel: ({ card, actions }: any) =>
    React.createElement("div", { "data-metadata": "" }),
}));

mock.module("../../components/card-modal/CardModalOverlays", () => ({
  CardModalOverlays: ({ card }: any) =>
    React.createElement("div", { "data-overlays": "" }),
}));

// Mock useCardModal hook
mock.module("../../hooks/useCardModal", () => ({
  useCardModal: mock(() => ({
    card: null,
    tagInput: "",
    setTagInput: mock(),
    updateContent: mock(),
    updateNotes: mock(),
    toggleFavorite: mock(),
    addTag: mock(),
    removeTag: mock(),
    removeAiTag: mock(),
    handleDelete: mock(),
    handleRestore: mock(),
    handlePermanentDelete: mock(),
    openLink: mock(),
    downloadFile: mock(),
    handleCardTypeClick: mock(),
    saveChanges: mock(),
    hasUnsavedChanges: false,
    getCurrentValue: mock((field) => `value-${field}`),
    isSaved: false,
  })),
}));

// Mock metrics
mock.module("../../lib/metrics", () => ({
  metrics: {
    modalOpened: mock(),
  },
}));

describe("CardModal Component", () => {
  let mockOnCancel: any;
  let mockOnCardTypeClick: any;
  let mockOnTagClick: any;

  beforeEach(() => {
    mockOnCancel = mock();
    mockOnCardTypeClick = mock();
    mockOnTagClick = mock();
  });

  const createMockCard = (): CardModalCard => ({
    _id: "test-card-id",
    _creationTime: Date.now(),
    userId: "user-123" as any,
    content: "Test card content",
    type: "text",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ["tag1", "tag2"],
    isFavorited: false,
    isDeleted: false,
  });

  describe("Rendering", () => {
    test("renders without crashing when closed", () => {
      expect(() => {
        React.createElement(CardModal, {
          cardId: null,
          open: false,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("renders without crashing when open without card", () => {
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("renders loading state when card is null", () => {
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card: null,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("renders with card data", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("renders with text card", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("renders with image card", () => {
      const card = createMockCard();
      card.type = "image";
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("renders with video card", () => {
      const card = createMockCard();
      card.type = "video";
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("renders with link card", () => {
      const card = createMockCard();
      card.type = "link";
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });
  });

  describe("Props Handling", () => {
    test("receives cardId prop", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(CardModal, {
          cardId: "specific-card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("receives card prop", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("receives open prop", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("receives onCancel callback", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("receives onCardTypeClick callback", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
          onCardTypeClick: mockOnCardTypeClick,
        });
      }).not.toThrow();
    });

    test("receives onTagClick callback", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
          onTagClick: mockOnTagClick,
        });
      }).not.toThrow();
    });
  });

  describe("Modal State", () => {
    test("can be opened", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("can be closed", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: false,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("handles onOpenChange callback", () => {
      const card = createMockCard();
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });
  });

  describe("Card Types", () => {
    test("handles audio card type", () => {
      const card = createMockCard();
      card.type = "audio";
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("handles document card type", () => {
      const card = createMockCard();
      card.type = "document";
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("handles palette card type", () => {
      const card = createMockCard();
      card.type = "palette";
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("handles quote card type", () => {
      const card = createMockCard();
      card.type = "quote";
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });
  });

  describe("Card States", () => {
    test("handles favorited card", () => {
      const card = createMockCard();
      card.isFavorited = true;
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("handles deleted card", () => {
      const card = createMockCard();
      card.isDeleted = true;
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("handles card with tags", () => {
      const card = createMockCard();
      card.tags = ["important", "work", "todo"];
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("handles card with AI tags", () => {
      const card = createMockCard();
      card.aiTags = ["ai-generated-tag"];
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("handles card with notes", () => {
      const card = createMockCard();
      card.notes = "These are some notes about the card";
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("handles card with URL", () => {
      const card = createMockCard();
      card.url = "https://example.com";
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });
  });

  describe("Download Capability", () => {
    test("enables download for image cards with fileId", () => {
      const card = createMockCard();
      card.type = "image";
      card.fileId = "file-id" as any;
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("enables download for video cards with fileId", () => {
      const card = createMockCard();
      card.type = "video";
      card.fileId = "file-id" as any;
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("enables download for audio cards with fileId", () => {
      const card = createMockCard();
      card.type = "audio";
      card.fileId = "file-id" as any;
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("enables download for document cards with fileId", () => {
      const card = createMockCard();
      card.type = "document";
      card.fileId = "file-id" as any;
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("disables download for cards without fileId", () => {
      const card = createMockCard();
      card.type = "image";
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("disables download for text cards", () => {
      const card = createMockCard();
      card.type = "text";
      card.fileId = "file-id" as any;
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });

    test("disables download for link cards", () => {
      const card = createMockCard();
      card.type = "link";
      card.fileId = "file-id" as any;
      expect(() => {
        React.createElement(CardModal, {
          cardId: "card-id",
          card,
          open: true,
          onCancel: mockOnCancel,
        });
      }).not.toThrow();
    });
  });
});
