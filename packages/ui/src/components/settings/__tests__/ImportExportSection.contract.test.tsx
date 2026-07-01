import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("../../ui/badge", () => ({
  Badge: ({ children, variant }: any) =>
    React.createElement("span", { "data-variant": variant }, children),
}));
mock.module("../../ui/button", () => ({
  Button: ({ children, onClick, variant }: any) =>
    React.createElement(
      "button",
      { onClick, type: "button", "data-variant": variant },
      children
    ),
}));
// The modal pulls in Convex-backed panels; the section contract only cares
// about the settings row + its entry-point button.
mock.module("../ImportExportDialog", () => ({
  ImportExportDialog: () => null,
}));

const { ImportExportSection } = await import("../ImportExportSection");

const noopHandlers = {
  onCancelExport: mock(() => Promise.resolve()),
  onDownloadExport: mock(() => Promise.resolve()),
  onStartExport: mock(() => Promise.resolve()),
};

describe("ImportExportSection", () => {
  test("renders a single Manage Data entry point in a settings row", () => {
    const markup = renderToStaticMarkup(
      <ImportExportSection
        exportLoading={false}
        exportState={{ job: null, canStartNew: true, quotaResetMs: 0 }}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Import/Export Data");
    expect(markup).toContain(">Manage</button>");
    // No dialog/panel content leaks onto the settings surface.
    expect(markup).not.toContain("Import Bookmarks");
    expect(markup).not.toContain("Start export");
  });

  test("shows a Preparing badge while an export is active", () => {
    const markup = renderToStaticMarkup(
      <ImportExportSection
        exportLoading={false}
        exportState={{
          job: {
            id: "job",
            status: "running",
            createdAt: 1,
            updatedAt: 1,
            downloadAvailable: false,
          },
          canStartNew: false,
          quotaResetMs: 0,
        }}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Preparing");
  });

  test("shows an Export ready badge when an artifact is downloadable", () => {
    const markup = renderToStaticMarkup(
      <ImportExportSection
        exportLoading={false}
        exportState={{
          job: {
            id: "job",
            status: "ready",
            createdAt: 1,
            updatedAt: 1,
            downloadAvailable: true,
          },
          canStartNew: false,
          quotaResetMs: 0,
        }}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Export ready");
  });
});
