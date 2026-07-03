import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("../../ui/badge", () => ({
  Badge: ({ children, variant }: any) =>
    React.createElement("span", { "data-variant": variant }, children),
}));

mock.module("../../ui/button", () => ({
  Button: ({ children, disabled, onClick, size, variant }: any) =>
    React.createElement(
      "button",
      {
        disabled,
        onClick,
        "data-size": size,
        "data-variant": variant,
      },
      children
    ),
  buttonVariants: () => "",
}));

mock.module("../../ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? React.createElement("div", { "data-dialog": "" }, children) : null,
  DialogContent: ({ children }: any) =>
    React.createElement("div", { "data-dialog-content": "" }, children),
  DialogDescription: ({ children }: any) =>
    React.createElement("p", { "data-dialog-description": "" }, children),
  DialogHeader: ({ children }: any) =>
    React.createElement("div", { "data-dialog-header": "" }, children),
  DialogTitle: ({ children }: any) =>
    React.createElement("h2", { "data-dialog-title": "" }, children),
}));

mock.module("../../ui/input", () => ({
  Input: ({ value, readOnly }: any) =>
    React.createElement("input", { readOnly, value }),
}));

mock.module("../../ui/spinner", () => ({
  Spinner: () => React.createElement("span", { "data-spinner": "" }),
}));

mock.module("sonner", () => ({
  toast: {
    error: mock(),
    loading: mock(() => "toast-id"),
    success: mock(),
  },
}));

const { ApiKeysDialog } = await import("../ApiKeysDialog");
const { ApiKeysSection } = await import("../ApiKeysSection");
const { shouldShowApiKeysSection } = await import("../apiKeysGating");

const keys = [
  {
    createdAt: 300,
    id: "component_key",
    lastUsedAt: 350,
    maskedKey: "teakapi_secret_live_a1b2c3d4_••••••••",
    name: "SDK Key",
    status: "active" as const,
  },
  {
    createdAt: 200,
    id: "disabled_key",
    maskedKey: "teakapi_secret_live_e5f6a7b8_••••••••",
    name: "Disabled Key",
    status: "disabled" as const,
  },
];

const handlers = {
  onCreateKey: mock(() => Promise.resolve({ key: "new-key" })),
  onRevokeKey: mock(() => Promise.resolve()),
  onRotateKey: mock(() => Promise.resolve({ key: "rotated-key" })),
};

describe("ApiKeysSection", () => {
  test("keeps the settings page compact", () => {
    const markup = renderToStaticMarkup(
      <ApiKeysSection isLoading={false} keys={keys} {...handlers} />
    );

    expect(markup).toContain("API Keys");
    expect(markup).toContain(">Manage</button>");
    expect(markup).not.toContain("Manage API Keys");
    expect(markup).toContain("2 keys");
    expect(markup).not.toContain("Update required");
    expect(markup).not.toContain("Generate Key");
  });
});

describe("shouldShowApiKeysSection gating", () => {
  test("hides the section while keys are still loading", () => {
    expect(shouldShowApiKeysSection(undefined)).toBe(false);
  });

  test("shows the section for keyless users so they can create a first key", () => {
    expect(shouldShowApiKeysSection([])).toBe(true);
  });

  test("shows the section once the user has at least one key", () => {
    expect(shouldShowApiKeysSection(keys)).toBe(true);
  });
});

describe("ApiKeysDialog", () => {
  test("renders component and disabled key states", () => {
    const markup = renderToStaticMarkup(
      <ApiKeysDialog
        isLoading={false}
        keys={keys}
        onOpenChange={mock()}
        open={true}
        {...handlers}
      />
    );

    expect(markup).toContain("Manage API Keys");
    expect(markup).toContain("Generate Key");
    expect(markup).toContain("SDK Key");
    expect(markup).toContain("Regenerate");
    expect(markup).not.toContain(">Disable<");
    expect(markup).toContain("Disabled Key");
    expect(markup).not.toContain(">Enable<");
    expect(markup).not.toContain("Update required");
    expect(markup).not.toContain(">Active</span>");
    expect(markup).not.toContain(">active<");
  });

  test("renames the old default key label in the modal", () => {
    const markup = renderToStaticMarkup(
      <ApiKeysDialog
        isLoading={false}
        keys={[
          {
            ...keys[0],
            name: "API Keys",
          },
        ]}
        onOpenChange={mock()}
        open={true}
        {...handlers}
      />
    );

    expect(markup).toContain("Default API key");
    expect(markup).not.toContain(">API Keys</span>");
  });

  test("renders terminal key statuses as destructive badges", () => {
    const markup = renderToStaticMarkup(
      <ApiKeysDialog
        isLoading={false}
        keys={[
          {
            ...keys[0],
            id: "exhausted_key",
            name: "Exhausted Key",
            status: "exhausted" as const,
          },
        ]}
        onOpenChange={mock()}
        open={true}
        {...handlers}
      />
    );

    expect(markup).toContain('data-variant="destructive"');
    expect(markup).toContain(">Exhausted</span>");
  });
});
