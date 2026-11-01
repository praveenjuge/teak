import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("../../ui/badge", () => ({
  Badge: ({ children, variant }: any) =>
    React.createElement("span", { "data-variant": variant }, children),
}));

mock.module("../../ui/button", () => ({
  Button: ({ children, disabled, onClick, size, variant, ...props }: any) =>
    React.createElement(
      "button",
      {
        disabled,
        onClick,
        "data-size": size,
        "data-variant": variant,
        type: "button",
        ...props,
      },
      children
    ),
  buttonVariants: () => "",
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

const { ApiKeysPanel } = await import("../ApiKeysPanel");

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
  onRevokeAllKeys: mock(() =>
    Promise.resolve({ hasMore: false, revokedCount: 0 })
  ),
  onRevokeKey: mock(() => Promise.resolve()),
  onRotateKey: mock(() => Promise.resolve({ key: "rotated-key" })),
};

describe("ApiKeysPanel", () => {
  test("renders component and disabled key states", () => {
    const markup = renderToStaticMarkup(
      <ApiKeysPanel isLoading={false} keys={keys} {...handlers} />
    );

    expect(markup).toContain("Create key");
    expect(markup).toContain("Revoke all keys");
    expect(markup).toContain("Up to 10 keys.");
    expect(markup).toContain('href="https://teakvault.com/docs/api"');
    expect(markup).toContain("Key");
    expect(markup).not.toContain("Last used");
    expect(markup).not.toContain("Created");
    expect(markup).not.toContain("Status");
    expect(markup).toContain("SDK Key");
    expect(markup).toContain("teakapi_secret_live_a1b2c3d4");
    expect(markup).toContain("Regenerate SDK Key");
    expect(markup).toContain("Regenerate key");
    expect(markup).toContain("Revoke key");
    expect(markup).not.toContain(">Disable<");
    expect(markup).toContain("Disabled Key");
    expect(markup).toContain("Disabled");
    expect(markup).not.toContain(">Enable<");
    expect(markup).not.toContain("Update required");
    expect(markup).not.toContain(">Active<");
    expect(markup).not.toContain("for API, MCP, and Raycast access");
  });

  test("does not render repeated default key names in the list", () => {
    const markup = renderToStaticMarkup(
      <ApiKeysPanel
        isLoading={false}
        keys={[
          {
            ...keys[0],
            name: "API Keys",
          },
        ]}
        {...handlers}
      />
    );

    expect(markup).not.toContain("Default API key");
    expect(markup).not.toContain(">API Keys<");
    expect(markup).not.toContain("Created");
    expect(markup).not.toContain("Last used");
  });

  test("keeps terminal key statuses out of the table", () => {
    const markup = renderToStaticMarkup(
      <ApiKeysPanel
        isLoading={false}
        keys={[
          {
            ...keys[0],
            id: "exhausted_key",
            name: "Terminal Key",
            status: "exhausted" as const,
          },
        ]}
        {...handlers}
      />
    );

    expect(markup).not.toContain('data-variant="destructive"');
    expect(markup).not.toContain("Exhausted");
    expect(markup).not.toContain("Regenerate Terminal Key");
    expect(markup).toContain("Revoke Terminal Key");
  });
});
