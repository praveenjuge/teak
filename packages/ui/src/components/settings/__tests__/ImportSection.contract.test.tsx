import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const convexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...convexReact,
  useAction: () => mock(),
  useQuery: () => null,
}));
mock.module("../../ui/badge", () => ({
  Badge: ({ children }: any) => React.createElement("span", null, children),
}));
mock.module("../../ui/button", () => ({
  Button: ({ children, ...props }: any) =>
    React.createElement("button", { type: "button", ...props }, children),
}));
mock.module("../../ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? React.createElement("div", null, children) : null,
  DialogContent: ({ children }: any) =>
    React.createElement("div", null, children),
  DialogDescription: ({ children }: any) =>
    React.createElement("p", null, children),
  DialogHeader: ({ children }: any) =>
    React.createElement("div", null, children),
  DialogTitle: ({ children }: any) => React.createElement("h2", null, children),
}));
mock.module("../../ui/spinner", () => ({
  Spinner: () => React.createElement("span", { "data-spinner": "" }),
}));
mock.module("sonner", () => ({ toast: { success: mock() } }));

const { ImportDialog, ImportProgressSummary } = await import("../ImportDialog");
const { ImportSection } = await import("../ImportSection");

describe("ImportSection", () => {
  test("keeps settings compact with one Import row and no open dialog", () => {
    const markup = renderToStaticMarkup(<ImportSection />);
    expect(markup.match(/>Import</g)).toHaveLength(2);
    expect(markup).not.toContain("Import Bookmarks");
    expect(markup).not.toContain("Import Teak Archive");
  });
});

describe("ImportDialog", () => {
  test("renders both backend import modes", () => {
    const markup = renderToStaticMarkup(
      <ImportDialog onOpenChange={mock()} open={true} />
    );
    expect(markup).toContain("Import Bookmarks");
    expect(markup).toContain("Import Teak Archive");
    expect(markup).toContain("Teak handles the import in the background");
  });

  test("renders active progress counts", () => {
    const markup = renderToStaticMarkup(
      <ImportProgressSummary
        job={{
          id: "job",
          status: "importing",
          createdCount: 2,
          failedCount: 1,
          reportAvailable: false,
          parsedCount: 8,
          phase: "Importing cards",
          processedCount: 4,
          skippedCount: 1,
        }}
      />
    );
    expect(markup).toContain("Importing cards");
    expect(markup).toContain("Parsed 8");
    expect(markup).toContain("Created 2");
    expect(markup).toContain("Skipped 1");
    expect(markup).toContain("Failed 1");
  });

  test("renders a concise completion summary", () => {
    const markup = renderToStaticMarkup(
      <ImportProgressSummary
        job={{
          id: "job",
          status: "completed",
          createdCount: 5,
          failedCount: 2,
          reportAvailable: true,
          parsedCount: 10,
          phase: "Import complete",
          processedCount: 10,
          skippedCount: 3,
        }}
      />
    );
    expect(markup).toContain("Import complete");
    expect(markup).toContain("Created 5");
    expect(markup).toContain("Skipped 3");
    expect(markup).toContain("Failed 2");
  });

  test("shows multipart upload progress", () => {
    const markup = renderToStaticMarkup(
      <ImportProgressSummary
        job={{
          id: "job",
          status: "uploading",
          createdCount: 0,
          failedCount: 0,
          reportAvailable: false,
          parsedCount: 0,
          phase: "Uploading",
          processedCount: 0,
          skippedCount: 0,
        }}
        uploadPercent={64}
      />
    );
    expect(markup).toContain("64%");
  });
});
