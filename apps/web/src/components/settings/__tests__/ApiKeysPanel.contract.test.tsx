import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

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
  test("lists each key by name and masked key, with regenerate and revoke", () => {
    const markup = renderToStaticMarkup(
      <ApiKeysPanel isLoading={false} keys={keys} {...handlers} />
    );

    expect(markup).toContain("Create key");
    expect(markup).toContain("Revoke all keys");
    expect(markup).toContain("Up to 10 keys.");
    expect(markup).toContain('href="https://teakvault.com/docs/api"');
    expect(markup).toContain("SDK Key");
    expect(markup).toContain("teakapi_secret_live_a1b2c3d4");
    expect(markup).toContain("Regenerate SDK Key");
    expect(markup).toContain("Regenerate Disabled Key");
    expect(markup).toContain("Revoke SDK Key");
    expect(markup).toContain("Revoke Disabled Key");
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

    expect(markup).not.toContain(">API Keys<");
    expect(markup).toContain("teakapi_secret_live_a1b2c3d4");
  });

  test("a key that can no longer be used can only be revoked", () => {
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

    expect(markup).not.toContain("Exhausted");
    expect(markup).not.toContain("Regenerate Terminal Key");
    expect(markup).toContain("Revoke Terminal Key");
  });
});
