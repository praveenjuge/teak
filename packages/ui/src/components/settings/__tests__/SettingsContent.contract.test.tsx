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
  ImportExportDialog: () => null,
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
  onCancelExport: mock(() => Promise.resolve()),
  onCreateApiKey: mock(() => Promise.resolve({ key: "teak_test" })),
  onCreateCustomerPortal: mock(() => Promise.resolve()),
  onDeleteAccount: mock(() => Promise.resolve()),
  onDeleteDialogOpenChange: mock(() => undefined),
  onDownloadExport: mock(() => Promise.resolve()),
  onRevokeApiKey: mock(() => Promise.resolve()),
  onRotateApiKey: mock(() => Promise.resolve({ key: "teak_rotated" })),
  onSignOut: mock(() => undefined),
  onStartExport: mock(() => Promise.resolve()),
  onUpgrade: mock(() => undefined),
  signOutLoading: false,
};

describe("SettingsContent", () => {
  test("uses one settings-level loading state before data is ready", () => {
    const markup = renderToStaticMarkup(
      <SettingsContent {...baseProps} isLoading={true} />
    );

    expect(markup).toContain("Settings");
    expect(markup).toContain("Loading settings");
    expect(markup).not.toContain("Email");
    expect(markup).not.toContain("Usage");
    expect(markup).not.toContain("Plan");
  });

  test("shows all settings rows together after data is ready", () => {
    const markup = renderToStaticMarkup(
      <SettingsContent {...baseProps} isLoading={false} />
    );

    expect(markup).toContain("hello@example.com");
    expect(markup).toContain("3 Cards");
    expect(markup).toContain("Free Plan");
    expect(markup).toContain("Import/Export Data");
  });
});
