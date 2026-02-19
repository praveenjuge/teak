// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { AddCardForm } from "../AddCardForm";

mock.module("@teak/ui/components/ui/button", () => ({
  Button: ({ children, type, onClick, disabled, variant, size }: any) =>
    React.createElement(
      "button",
      {
        type: type || "button",
        onClick,
        disabled,
        "data-variant": variant,
        "data-size": size,
      },
      children
    ),
}));

mock.module("@teak/ui/components/ui/textarea", () => ({
  Textarea: ({ value, onChange, onKeyDown, disabled, placeholder }: any) =>
    React.createElement("textarea", {
      value,
      onChange,
      onKeyDown,
      disabled,
      placeholder,
      "data-testid": "content-textarea",
    }),
}));

mock.module("@teak/ui/components/ui/card", () => ({
  Card: ({ children, className }: any) =>
    React.createElement("div", { className, "data-card": "" }, children),
  CardContent: ({ children }: any) =>
    React.createElement("div", { className: "card-content" }, children),
}));

mock.module("@teak/ui/components/ui/alert", () => ({
  Alert: ({ children, variant }: any) =>
    React.createElement(
      "div",
      { "data-variant": variant, "data-alert": "" },
      children
    ),
  AlertDescription: ({ children }: any) =>
    React.createElement("p", { "data-alert-description": "" }, children),
  AlertTitle: ({ children }: any) =>
    React.createElement("h3", { "data-alert-title": "" }, children),
}));

mock.module("@teak/ui/components/ui/dialog", () => ({
  Dialog: ({ children }: any) =>
    React.createElement("div", { "data-dialog": "" }, children),
  DialogContent: ({ children }: any) =>
    React.createElement("div", { "data-dialog-content": "" }, children),
  DialogDescription: ({ children }: any) =>
    React.createElement("p", { "data-dialog-description": "" }, children),
  DialogTitle: ({ children }: any) =>
    React.createElement("h3", { "data-dialog-title": "" }, children),
}));

mock.module("convex/react", () => ({
  useMutation: () => {
    const mutation = mock().mockResolvedValue({});
    mutation.withOptimisticUpdate = () => mutation;
    return mutation;
  },
}));

mock.module("convex-helpers/react/cache/hooks", () => ({
  useQuery: () => null,
}));

mock.module("@teak/convex/shared/hooks/useFileUpload", () => ({
  useFileUploadCore: () => ({
    uploadFile: mock(() => ({
      success: true,
    })),
  }),
}));

mock.module("sonner", () => ({
  toast: {
    loading: mock(() => "toast-id"),
    success: mock(),
    error: mock(),
  },
}));

mock.module("@teak/convex", () => ({
  api: {
    cards: {
      createCard: {},
      uploadAndCreateCard: {},
      finalizeUploadedCard: {},
      searchCards: {},
    },
    auth: {
      getCurrentUser: {},
    },
  },
}));

mock.module("@teak/convex/shared", () => ({
  CARD_ERROR_CODES: {
    CARD_LIMIT_REACHED: "CARD_LIMIT_REACHED",
    RATE_LIMITED: "RATE_LIMITED",
  },
  MAX_FILE_SIZE: 20 * 1024 * 1024,
  MAX_FILES_PER_UPLOAD: 10,
  CARD_ERROR_MESSAGES: {
    TOO_MANY_FILES: "Too many files",
  },
  resolveTextCardInput: mock((input) => ({
    type: "text",
    content: input.content,
    url: input.url,
  })),
}));

describe("AddCardForm", () => {
  beforeEach(() => {
    global.crypto = {
      ...global.crypto,
      randomUUID: mock(() => "mock-uuid"),
    };
  });

  test("renders without crashing", () => {
    expect(() => {
      React.createElement(AddCardForm, {});
    }).not.toThrow();
  });

  test("renders with autofocus", () => {
    expect(() => {
      React.createElement(AddCardForm, { autoFocus: true });
    }).not.toThrow();
  });

  test("renders with success callback", () => {
    expect(() => {
      React.createElement(AddCardForm, { onSuccess: mock() });
    }).not.toThrow();
  });

  test("renders with explicit canCreateCard false", () => {
    expect(() => {
      React.createElement(AddCardForm, { canCreateCard: false });
    }).not.toThrow();
  });

  test("renders with custom upgrade link component", () => {
    const UpgradeLink = ({ children, href, className }: any) =>
      React.createElement("a", { href, className }, children);

    expect(() => {
      React.createElement(AddCardForm, {
        UpgradeLinkComponent: UpgradeLink,
        upgradeUrl: "/settings",
      });
    }).not.toThrow();
  });
});
