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
      { disabled, onClick, "data-size": size, "data-variant": variant },
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

const { ExportDataDialog } = await import("../ExportDataDialog");
const { ExportDataSection } = await import("../ExportDataSection");

const noopHandlers = {
  onCancelExport: mock(() => Promise.resolve()),
  onDownloadExport: mock(() => Promise.resolve()),
  onStartExport: mock(() => Promise.resolve()),
};

const readyState = {
  job: {
    id: "job_ready",
    status: "ready" as const,
    cardCount: 42,
    filesIncluded: 40,
    filesOmitted: 2,
    artifactBytes: 5 * 1024 * 1024,
    createdAt: 100,
    updatedAt: 200,
    completedAt: 200,
    expiresAt: 1_900_000_000_000,
    downloadAvailable: true,
  },
  canStartNew: false,
  quotaResetMs: 3 * 24 * 60 * 60 * 1000,
};

const activeState = {
  job: {
    id: "job_active",
    status: "running" as const,
    createdAt: 100,
    updatedAt: 150,
    downloadAvailable: false,
  },
  canStartNew: false,
  quotaResetMs: 0,
};

const idleState = {
  job: null,
  canStartNew: true,
  quotaResetMs: 0,
};

describe("ExportDataSection", () => {
  test("keeps the settings page compact", () => {
    const markup = renderToStaticMarkup(
      <ExportDataSection
        exportState={idleState}
        isLoading={false}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Export Data");
    expect(markup).toContain(">Manage</button>");
    expect(markup).not.toContain("Export Your Data");
  });

  test("shows a Preparing badge while an export is active", () => {
    const markup = renderToStaticMarkup(
      <ExportDataSection
        exportState={activeState}
        isLoading={false}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Preparing");
  });

  test("shows a Ready badge when an artifact is downloadable", () => {
    const markup = renderToStaticMarkup(
      <ExportDataSection
        exportState={readyState}
        isLoading={false}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Ready");
  });
});

describe("ExportDataDialog", () => {
  test("renders the start state with a Start export button", () => {
    const markup = renderToStaticMarkup(
      <ExportDataDialog
        exportState={idleState}
        isLoading={false}
        onOpenChange={mock()}
        open={true}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Export Your Data");
    expect(markup).toContain("Start export");
    expect(markup).not.toContain("Download archive");
  });

  test("renders a quota-blocked state when a new export is not allowed", () => {
    const markup = renderToStaticMarkup(
      <ExportDataDialog
        exportState={{ job: null, canStartNew: false, quotaResetMs: 2 * 24 * 60 * 60 * 1000 }}
        isLoading={false}
        onOpenChange={mock()}
        open={true}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Available in");
    expect(markup).not.toContain(">Start export");
  });

  test("renders the active state with a Cancel button and spinner", () => {
    const markup = renderToStaticMarkup(
      <ExportDataDialog
        exportState={activeState}
        isLoading={false}
        onOpenChange={mock()}
        open={true}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Preparing your export");
    expect(markup).toContain("Cancel export");
    expect(markup).toContain("data-spinner");
  });

  test("renders the ready state with download, counts, and expiry", () => {
    const markup = renderToStaticMarkup(
      <ExportDataDialog
        exportState={readyState}
        isLoading={false}
        onOpenChange={mock()}
        open={true}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Your export is ready");
    expect(markup).toContain("Download archive");
    expect(markup).toContain("42 cards");
    expect(markup).toContain("2 files unavailable");
    expect(markup).toContain("until");
  });

  test("renders a failed state and offers a retry", () => {
    const failedState = {
      job: {
        id: "job_failed",
        status: "failed" as const,
        failureClass: "archive_failed",
        createdAt: 100,
        updatedAt: 200,
        downloadAvailable: false,
      },
      canStartNew: true,
      quotaResetMs: 0,
    };
    const markup = renderToStaticMarkup(
      <ExportDataDialog
        exportState={failedState}
        isLoading={false}
        onOpenChange={mock()}
        open={true}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("You can try again");
    expect(markup).toContain("Start export");
  });

  test("shows a spinner while loading", () => {
    const markup = renderToStaticMarkup(
      <ExportDataDialog
        exportState={undefined}
        isLoading={true}
        onOpenChange={mock()}
        open={true}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("data-spinner");
    expect(markup).not.toContain("Start export");
  });
});
