import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const convexReact = await import("convex/react");
let importQueryResult: unknown = null;
mock.module("convex/react", () => ({
  ...convexReact,
  useAction: () => mock(),
  useQuery: () => importQueryResult,
}));
mock.module("../../ui/button", () => ({
  Button: ({ children, ...props }: any) =>
    React.createElement("button", { type: "button", ...props }, children),
}));
mock.module("../../ui/spinner", () => ({
  Spinner: () => React.createElement("span", { "data-spinner": "" }),
}));
mock.module("sonner", () => ({
  toast: { error: mock(), loading: mock(() => "id"), success: mock() },
}));

const { ImportPanel, ImportProgressSummary } = await import("../ImportPanel");
const { putParts } = await import("../importUpload");

describe("ImportPanel", () => {
  test("renders all backend import modes", () => {
    const markup = renderToStaticMarkup(<ImportPanel />);
    expect(markup).toContain("Import Bookmarks");
    expect(markup).toContain("Import Teak Archive");
    expect(markup).toContain("Import from Raindrop");
  });

  test("shows an empty last-import state when there are no imports", () => {
    const markup = renderToStaticMarkup(<ImportPanel />);
    expect(markup).toContain("No imports yet.");
  });

  test("offers a resume prompt when a persisted upload was interrupted", () => {
    importQueryResult = {
      id: "job",
      mode: "bookmarks",
      status: "uploading",
      createdCount: 0,
      failedCount: 0,
      reportAvailable: false,
      parsedCount: 0,
      phase: "Uploading",
      processedCount: 0,
      skippedCount: 0,
      updatedAt: 0,
    };
    try {
      const markup = renderToStaticMarkup(<ImportPanel />);
      expect(markup).toContain("Upload interrupted");
      expect(markup).toContain("Resume upload");
      // The interrupted upload can also be discarded.
      expect(markup).toContain("Cancel import");
      // The resting last-import row and mode picker stay hidden while resuming.
      expect(markup).not.toContain("No imports yet.");
    } finally {
      importQueryResult = null;
    }
  });

  test("renders active phase, progress, and non-zero counts", () => {
    const markup = renderToStaticMarkup(
      <ImportProgressSummary
        job={{
          id: "job",
          mode: "bookmarks",
          status: "importing",
          createdCount: 2,
          failedCount: 1,
          reportAvailable: false,
          parsedCount: 8,
          phase: "Importing cards",
          processedCount: 4,
          skippedCount: 1,
          updatedAt: 0,
        }}
      />
    );
    expect(markup).toContain("Importing cards");
    expect(markup).toContain("2 created");
    expect(markup).toContain("1 skipped");
    expect(markup).toContain("1 failed");
  });

  test("renders a concise completion summary", () => {
    const markup = renderToStaticMarkup(
      <ImportProgressSummary
        job={{
          id: "job",
          mode: "archive",
          status: "completed",
          createdCount: 5,
          failedCount: 2,
          reportAvailable: true,
          parsedCount: 10,
          phase: "Import complete",
          processedCount: 10,
          skippedCount: 3,
          updatedAt: 0,
        }}
      />
    );
    expect(markup).toContain("Import complete");
    expect(markup).toContain("5 created");
    expect(markup).toContain("3 skipped");
    expect(markup).toContain("2 failed");
  });

  test("shows multipart upload progress and hides counts", () => {
    const markup = renderToStaticMarkup(
      <ImportProgressSummary
        job={{
          id: "job",
          mode: "bookmarks",
          status: "uploading",
          createdCount: 0,
          failedCount: 0,
          reportAvailable: false,
          parsedCount: 0,
          phase: "Uploading",
          processedCount: 0,
          skippedCount: 0,
          updatedAt: 0,
        }}
        uploadPercent={64}
      />
    );
    expect(markup).toContain("64%");
    expect(markup).not.toContain("0 created");
  });

  test("aborts and drains sibling uploads after the first failure", async () => {
    const originalFetch = globalThis.fetch;
    const uploadFetch = mock(
      (_url: string | URL | Request, init?: RequestInit) => {
        if (String(_url).endsWith("/1")) {
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
    );
    globalThis.fetch = uploadFetch as typeof fetch;
    const controllers = new Set<AbortController>();

    try {
      await expect(
        putParts(
          new File([new Uint8Array([1, 2, 3])], "bookmarks.html"),
          {
            jobId: "job",
            partSize: 1,
            parts: [1, 2, 3].map((partNumber) => ({
              partNumber,
              url: `https://uploads.example/${partNumber}`,
            })),
            uploadedParts: [],
          },
          mock(),
          controllers
        )
      ).rejects.toThrow("Upload part 1 failed (500)");
      expect(uploadFetch).toHaveBeenCalledTimes(3);
      expect(controllers.size).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
