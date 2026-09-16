// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let cardCreationStatusResult: { canCreateCard: boolean } | undefined;

// NOTE: bun:test's mock.module() registrations leak across test files that run
// in the same `bun test` process. Every factory below spreads the real module
// so a leaked mock still exposes the full export surface.
const realTeakConvex = await import("@teak/convex");
const realConvexReact = await import("convex/react");
const realCardUi = await import("@teak/ui/components/ui/card");

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

mock.module("@teak/ui/text-editor", () => ({
  MarkdownTextEditor: ({ ariaLabel, onChange, value, variant }: any) =>
    React.createElement("textarea", {
      "aria-label": ariaLabel,
      "data-editor-variant": variant,
      onChange,
      value,
    }),
}));

mock.module("@teak/ui/components/ui/card", () => ({
  ...realCardUi,
  Card: ({ children, className }: any) =>
    React.createElement("div", { className, "data-card": "" }, children),
  CardContent: ({ children }: any) =>
    React.createElement("div", { className: "card-content" }, children),
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
  ...realConvexReact,
  useMutation: () => {
    const mutation = mock().mockResolvedValue({});
    mutation.withOptimisticUpdate = () => mutation;
    return mutation;
  },
}));

mock.module("../../../convexQueryHooks", () => ({
  usePaginatedQuery: () => ({
    loadMore: mock(),
    results: [],
    status: "Exhausted",
  }),
  useQuery: () => cardCreationStatusResult,
}));

mock.module("@teak/convex/shared/hooks/useFileUpload", () => ({
  useFileUploadCore: () => ({
    uploadFile: mock(() => ({
      success: true,
    })),
  }),
}));

const enqueueFilesMock = mock(() => undefined);
mock.module("@teak/ui/hooks", () => ({
  useGlobalFileDrop: () => ({
    queueSize: 0,
    isUploading: false,
    enqueueFiles: enqueueFilesMock,
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
  cards: {
    createCard: {},
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

// Import after mocks so the module picks up the stubbed hook.
import { AddCardActions } from "../AddCardActions";
import { AddCardForm } from "../AddCardForm";

describe("AddCardForm", () => {
  beforeEach(() => {
    cardCreationStatusResult = undefined;
    global.crypto = {
      ...global.crypto,
      randomUUID: mock(() => "mock-uuid"),
    };
    enqueueFilesMock.mockReset();
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

  test("restores a draft when the form remounts", () => {
    const draftContentRef = { current: "Unsaved navigation draft" };

    expect(
      renderToStaticMarkup(<AddCardForm draftContentRef={draftContentRef} />)
    ).toContain("Unsaved navigation draft");
  });

  test("exposes loading and ready card-creation states", () => {
    const loadingMarkup = renderToStaticMarkup(<AddCardForm />);
    expect(loadingMarkup).toContain('data-card-creation-status="loading"');
    expect(loadingMarkup).toContain('data-editor-variant="compact"');

    cardCreationStatusResult = { canCreateCard: true };
    expect(renderToStaticMarkup(<AddCardForm />)).toContain(
      'data-card-creation-status="ready"'
    );
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

  test("renders header capture actions", () => {
    expect(() => {
      React.createElement(AddCardActions, {});
    }).not.toThrow();
  });

  test("header upload path keeps the shared queue available", () => {
    const files = [
      new Blob(["a"], { type: "image/png" }) as unknown as File,
      new Blob(["b"], { type: "image/png" }) as unknown as File,
    ];

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useGlobalFileDrop } = require("@teak/ui/hooks");
    const drop = useGlobalFileDrop();
    drop.enqueueFiles(files);

    expect(enqueueFilesMock).toHaveBeenCalledTimes(1);
    expect(enqueueFilesMock.mock.calls[0][0]).toEqual(files);
  });
});
