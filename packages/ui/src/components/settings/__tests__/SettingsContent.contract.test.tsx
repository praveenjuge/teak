import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("../ApiKeysSection", () => ({
  ApiKeysSection: () => React.createElement("section", null, "API keys"),
}));
mock.module("../DeleteAccountDialog", () => ({
  DeleteAccountDialog: () => null,
}));
mock.module("../ImportExportDialog", () => ({
  ImportExportDialog: ({ exportLoading }: { exportLoading: boolean }) =>
    React.createElement(
      "span",
      null,
      exportLoading ? "Export loading" : "Export ready"
    ),
}));
mock.module("../SettingsFooter", () => ({
  SettingsFooter: () => React.createElement("footer", null, "Footer"),
}));
mock.module("../ThemeToggle", () => ({
  ThemeToggle: () => React.createElement("div", null, "Theme toggle"),
}));

const { SettingsContent } = await import("../SettingsContent");

const baseProps = {
  cardCount: 3,
  deleteDialogError: null,
  deleteDialogOpen: false,
  deleteLoading: false,
  email: "hello@example.com",
  exportState: { job: null, canStartNew: true, quotaResetMs: 0 },
  hasPremium: false,
  keys: [],
  oauthConnections: [],
  onCancelExport: mock(() => Promise.resolve()),
  onCreateApiKey: mock(() => Promise.resolve({ key: "teak_test" })),
  onCreateCustomerPortal: mock(() => Promise.resolve()),
  onDeleteAccount: mock(() => Promise.resolve()),
  onDeleteDialogOpenChange: mock(() => undefined),
  onDownloadExport: mock(() => Promise.resolve()),
  onRevokeAllApiKeys: mock(() =>
    Promise.resolve({ hasMore: false, revokedCount: 0 })
  ),
  onRevokeApiKey: mock(() => Promise.resolve()),
  onRevokeOAuthConnection: mock(() => Promise.resolve()),
  onRotateApiKey: mock(() => Promise.resolve({ key: "teak_rotated" })),
  onSignOut: mock(() => undefined),
  onStartExport: mock(() => Promise.resolve()),
  onUpgrade: mock(() => undefined),
  signOutLoading: false,
};

describe("SettingsContent", () => {
  test("keeps independent controls available while account data loads", () => {
    const markup = renderToStaticMarkup(
      <SettingsContent {...baseProps} accountLoading={true} cardCount={0} />
    );

    expect(markup).toContain("Settings");
    expect(markup).toContain("Theme toggle");
    expect(markup).toContain("Sign out");
    expect(markup).toContain("Import/Export Data");
    expect(markup).not.toContain("Loading settings");
    expect(markup).not.toContain("hello@example.com");
    expect(markup).not.toContain("0 Cards");
    expect(markup).not.toContain("Free Plan");
    expect(markup).not.toContain("Upgrade");
  });

  test("shows account details while keys, connections, and export are pending", () => {
    const markup = renderToStaticMarkup(
      <SettingsContent
        {...baseProps}
        accountLoading={false}
        exportState={undefined}
        keys={undefined}
        oauthConnections={undefined}
      />
    );

    expect(markup).toContain("hello@example.com");
    expect(markup).toContain("3 Cards");
    expect(markup).toContain("API Keys");
    expect(markup).toContain("Connected apps");
    expect(markup).toContain("Export loading");
    expect(markup).toContain("Theme toggle");
    expect(markup).not.toContain("No apps are connected");
  });

  test("shows all settings rows together after data is ready", () => {
    const markup = renderToStaticMarkup(
      <SettingsContent {...baseProps} accountLoading={false} />
    );

    expect(markup).toContain("hello@example.com");
    expect(markup).toContain("3 Cards");
    expect(markup).toContain("Free Plan");
    expect(markup).toContain("Import/Export Data");
  });
});
