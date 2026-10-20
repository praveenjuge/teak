import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const convexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...convexReact,
  useQuery: () => undefined,
}));

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
        type: "button",
        "data-size": size,
        "data-variant": variant,
      },
      children
    ),
  buttonVariants: () => "",
}));

mock.module("../../ui/spinner", () => ({
  Spinner: () => React.createElement("span", { "data-spinner": "" }),
}));

mock.module("sonner", () => ({
  toast: { error: mock(), loading: mock(() => "toast-id"), success: mock() },
}));

const { ExportPanel } = await import("../ExportPanel");

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

describe("ExportPanel", () => {
  test("renders the start state with a Start export button", () => {
    const markup = renderToStaticMarkup(
      <ExportPanel
        exportState={idleState}
        isLoading={false}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Start export");
    expect(markup).not.toContain("Download archive");
  });

  test("renders a quota-blocked countdown when a new export is not allowed", () => {
    const markup = renderToStaticMarkup(
      <ExportPanel
        exportState={{
          job: null,
          canStartNew: false,
          quotaResetMs: 2 * 24 * 60 * 60 * 1000,
        }}
        isLoading={false}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Available in");
    expect(markup).not.toContain(">Start export");
  });

  test("renders the active state with a Cancel button and spinner", () => {
    const markup = renderToStaticMarkup(
      <ExportPanel
        exportState={activeState}
        isLoading={false}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Preparing your export");
    expect(markup).toContain("Cancel export");
    expect(markup).toContain("data-spinner");
  });

  test("shows a live snapshot count while snapshotting", () => {
    const markup = renderToStaticMarkup(
      <ExportPanel
        exportState={{
          job: {
            id: "job_snap",
            status: "running" as const,
            stage: "snapshotting" as const,
            processedCount: 240,
            createdAt: 100,
            updatedAt: 150,
            downloadAvailable: false,
          },
          canStartNew: false,
          quotaResetMs: 0,
        }}
        isLoading={false}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("Snapshotting");
    expect(markup).toContain("240 cards");
  });

  test("renders the ready state with download, counts, and expiry", () => {
    const markup = renderToStaticMarkup(
      <ExportPanel
        exportState={readyState}
        isLoading={false}
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
      <ExportPanel
        exportState={failedState}
        isLoading={false}
        {...noopHandlers}
      />
    );
    expect(markup).toContain("You can try again");
    expect(markup).toContain("Start export");
  });

  test("shows a spinner while loading", () => {
    const markup = renderToStaticMarkup(
      <ExportPanel exportState={undefined} isLoading={true} {...noopHandlers} />
    );
    expect(markup).toContain("data-spinner");
    expect(markup).not.toContain("Start export");
  });
});
