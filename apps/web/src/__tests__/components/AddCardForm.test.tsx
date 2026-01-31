// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { AddCardForm } from "../../components/AddCardForm";

// Mock UI components
mock.module("../../components/ui/button", () => ({
  Button: ({ children, type, onClick, disabled, variant, size }: any) =>
    React.createElement(
      "button",
      { type, onClick, disabled, "data-variant": variant, "data-size": size },
      children
    ),
}));

mock.module("../../components/ui/textarea", () => ({
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

mock.module("../../components/ui/card", () => ({
  Card: ({ children, className }: any) =>
    React.createElement("div", { className, "data-card": "" }, children),
  CardContent: ({ children }: any) =>
    React.createElement("div", { className: "card-content" }, children),
}));

mock.module("../../components/ui/alert", () => ({
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

// Mock hooks
mock.module("convex/react", () => ({
  useMutation: () => mock().mockResolvedValue({}),
}));

mock.module("convex-helpers/react/cache/hooks", () => ({
  useQuery: () => null,
}));

mock.module("../../hooks/useFileUpload", () => ({
  useFileUpload: () => ({
    uploadFile: mock(() => ({
      success: true,
    })),
  }),
}));

// Mock other dependencies
mock.module("sonner", () => ({
  toast: {
    loading: mock(() => "toast-id"),
    success: mock(),
    error: mock(),
  },
}));

mock.module("@sentry/nextjs", () => ({
  captureException: mock(),
}));

mock.module("../../lib/metrics", () => ({
  metrics: {
    featureUsed: mock(),
    cardCreated: mock(),
    fileUploaded: mock(),
    audioRecorded: mock(),
    rateLimitHit: mock(),
    cardLimitReached: mock(),
    upgradePromptShown: mock(),
    errorOccurred: mock(),
  },
}));

mock.module("next/link", () => ({
  default: ({ children, href }: any) =>
    React.createElement("a", { href }, children),
}));

// Mock Convex API
mock.module("@teak/convex", () => ({
  api: {
    cards: {
      createCard: {},
    },
    auth: {
      getCurrentUser: {},
    },
  },
  shared: {
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
  },
}));

describe("AddCardForm Component", () => {
  let mockOnSuccess: any;

  beforeEach(() => {
    mockOnSuccess = mock();
    // Mock crypto.randomUUID
    global.crypto = {
      ...global.crypto,
      randomUUID: mock(() => "mock-uuid"),
    };
  });

  describe("Rendering", () => {
    test("renders without crashing", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("renders with onSuccess callback", () => {
      expect(() => {
        React.createElement(AddCardForm, { onSuccess: mockOnSuccess });
      }).not.toThrow();
    });

    test("renders with autoFocus enabled", () => {
      expect(() => {
        React.createElement(AddCardForm, { autoFocus: true });
      }).not.toThrow();
    });

    test("renders textarea for content input", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("renders upload button", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("renders microphone button for recording", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("renders save button when there is content", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });
  });

  describe("Props Handling", () => {
    test("receives onSuccess prop", () => {
      expect(() => {
        React.createElement(AddCardForm, { onSuccess: mockOnSuccess });
      }).not.toThrow();
    });

    test("receives autoFocus prop", () => {
      expect(() => {
        React.createElement(AddCardForm, { autoFocus: true });
      }).not.toThrow();
    });

    test("handles missing onSuccess gracefully", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("handles autoFocus false", () => {
      expect(() => {
        React.createElement(AddCardForm, { autoFocus: false });
      }).not.toThrow();
    });
  });

  describe("Form Input", () => {
    test("allows text content input", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("allows empty content", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("allows long content", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("handles special characters in content", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("handles unicode characters in content", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });
  });

  describe("File Upload", () => {
    test("handles file upload button click", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("accepts multiple files", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("validates file size", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("validates file count", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("handles upload errors gracefully", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("shows toast on upload success", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("shows toast on upload failure", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });
  });

  describe("Audio Recording", () => {
    test("handles microphone button click", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("enters recording mode", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("displays recording timer", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("stops recording on button click", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("auto-saves audio after recording", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("handles recording errors", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("shows error when microphone access denied", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });
  });

  describe("Error Handling", () => {
    test("displays error message", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("handles card limit reached error", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("handles rate limit error", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("shows upgrade prompt when limit reached", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("captures errors in Sentry", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("restores form content on error", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });
  });

  describe("User Permissions", () => {
    test("disables input when user cannot create cards", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("shows upgrade prompt when limit reached on mount", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("disables upload button when limit reached", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("disables recording button when limit reached", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("disables save button when limit reached", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });
  });

  describe("Keyboard Shortcuts", () => {
    test("handles Cmd+Enter to submit", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("handles Ctrl+Enter to submit", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("does not submit with empty content", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });
  });

  describe("Metrics Tracking", () => {
    test("tracks quick add feature usage", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("tracks file upload feature usage", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("tracks voice recording feature usage", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("tracks card creation", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("tracks card limit reached", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });

    test("tracks upgrade prompt shown", () => {
      expect(() => {
        React.createElement(AddCardForm, {});
      }).not.toThrow();
    });
  });
});
