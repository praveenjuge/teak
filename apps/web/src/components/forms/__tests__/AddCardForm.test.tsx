import { beforeEach, describe, expect, mock, test } from "bun:test";
import "@/__tests__/helpers/nextRouter";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let cardCreationStatusResult: { canCreateCard: boolean } | undefined;

const realTeakConvex = await import("@teak/convex");
const realConvexReact = await import("convex/react");
const realCardUi = await import("@/components/ui/card");

mock.module("@/components/ui/button", () => ({
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

mock.module("@/components/ui/textarea", () => ({
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

mock.module("@/components/text-editor", () => ({
  MarkdownTextEditor: ({ ariaLabel, onChange, value, variant }: any) =>
    React.createElement("textarea", {
      "aria-label": ariaLabel,
      "data-editor-variant": variant,
      onChange,
      value,
    }),
}));

mock.module("@/components/ui/card", () => ({
  ...realCardUi,
  Card: ({ children, className }: any) =>
    React.createElement("div", { className, "data-card": "" }, children),
  CardContent: ({ children }: any) =>
    React.createElement("div", { className: "card-content" }, children),
}));

mock.module("@/components/ui/dialog", () => ({
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
  ...realConvexReact,
  useMutation: () => {
    const mutation = mock().mockResolvedValue({});
    return Object.assign(mutation, { withOptimisticUpdate: () => mutation });
  },
}));

mock.module("../../../lib/convexQueryHooks", () => ({
  usePaginatedQuery: () => ({
    loadMore: mock(),
    results: [],
    status: "Exhausted",
  }),
  useQuery: () => cardCreationStatusResult,
}));

mock.module("@/hooks/useFileUploadCore", () => ({
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

const addCardApi = {
  card: {
    pasteLinks: { getLinkPaste: {}, startLinkPaste: {} },
  },
  cards: {
    createCard: {},
    createCardWithOutcome: {},
    uploadAndCreateCard: {},
    finalizeUploadedCard: {},
    searchCards: {},
  },
  auth: {
    getCurrentUser: {},
    getCardCreationStatus: {},
  },
  dataImport: {
    getImportFailureSamples: {},
    getLatestImport: {},
  },
  importUpload: {
    cancelImport: {},
    completeImportUpload: {},
    createImportUpload: {},
    getImportReportUrl: {},
    resumeImportUpload: {},
  },
};
mock.module("@teak/convex", () => ({
  ...realTeakConvex,
  // `api` is a path-dynamic proxy that cannot be spread; fall back to the real
  // proxy for paths this test does not stub.
  api: new Proxy(addCardApi, {
    get: (target, prop, receiver) =>
      typeof prop === "string" && !(prop in target)
        ? (realTeakConvex.api as any)[prop]
        : Reflect.get(target, prop, receiver),
  }),
}));

mock.module("@teak/convex/shared", () => ({
  CARD_ERROR_CODES: {
    CARD_LIMIT_REACHED: "CARD_LIMIT_REACHED",
    RATE_LIMITED: "RATE_LIMITED",
  },
  MAX_FILE_SIZE: 100 * 1024 * 1024,
  MAX_FILES_PER_UPLOAD: 5,
  CARD_ERROR_MESSAGES: {
    TOO_MANY_FILES: "Too many files",
  },
  resolveTextCardInput: mock((input) => ({
    type: "text",
    content: input.content,
    url: input.url,
  })),
}));

const { AddCardForm } = await import("../AddCardForm");
const { ComposerProvider } = await import("../ComposerProvider");

const composer = () => (
  <ComposerProvider>
    <AddCardForm />
  </ComposerProvider>
);

describe("AddCardForm", () => {
  beforeEach(() => {
    cardCreationStatusResult = undefined;
    global.crypto = {
      ...global.crypto,
      randomUUID: mock(() => "mock-uuid" as ReturnType<Crypto["randomUUID"]>),
    };
  });

  test("exposes loading and ready card-creation states", () => {
    const loadingMarkup = renderToStaticMarkup(composer());
    expect(loadingMarkup).toContain('data-card-creation-status="loading"');
    expect(loadingMarkup).toContain('data-editor-variant="compact"');

    cardCreationStatusResult = { canCreateCard: true };
    expect(renderToStaticMarkup(composer())).toContain(
      'data-card-creation-status="ready"'
    );
  });

  test("shows the N key hint only where there's a keyboard to press it", () => {
    const markup = renderToStaticMarkup(composer());
    const hint = markup.match(
      /class="([^"]*group-focus-within\/composer:hidden[^"]*)"/
    )?.[1];
    expect(hint).toContain("pointer-coarse:hidden");
  });
});
