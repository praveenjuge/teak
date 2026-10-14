import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const convexReact = await import("convex/react");
let importQueryResult: unknown = null;
let failureSamplesResult: unknown;
mock.module("convex/react", () => ({
  ...convexReact,
  useAction: () => mock(),
  useMutation: () => mock(),
}));
mock.module("../../../convexQueryHooks", () => ({
  usePaginatedQuery: () => ({
    loadMore: mock(),
    results: [],
    status: "Exhausted",
  }),
  // getImportFailureSamples is the only import query that takes a job id.
  useQuery: (_query: unknown, args?: unknown) =>
    args && typeof args === "object" && "jobId" in args
      ? failureSamplesResult
      : importQueryResult,
}));
mock.module("../../ui/button", () => ({
  Button: ({ children, ...props }: any) =>
    React.createElement("button", { type: "button", ...props }, children),
  buttonVariants: () => "",
}));
mock.module("../../ui/spinner", () => ({
  Spinner: () => React.createElement("span", { "data-spinner": "" }),
}));
mock.module("sonner", () => ({
  toast: { error: mock(), loading: mock(() => "id"), success: mock() },
}));

const { ImportPanel, ImportProgressSummary } = await import("../ImportPanel");
const { putParts } = await import("../importUpload");

function renderImportPanel() {
  return renderToStaticMarkup(<ImportPanel />);
}

describe("ImportPanel", () => {
  test("opens on browser bookmarks with its guidance and one Choose file", () => {
    const markup = renderImportPanel();
    expect(markup).toContain("Import from");
    expect(markup).toContain(
      "The bookmarks HTML file from your browser&#x27;s Export bookmarks."
    );
    expect(markup).toContain("Choose file");
    expect(markup).toContain('accept=".html,.htm"');
  });

  test("words a file that isn't the chosen source's export", () => {
    importQueryResult = {
      id: "job",
      mode: "pocket",
      status: "failed",
      failureClass: "invalid_source",
      createdCount: 0,
      failedCount: 0,
      reportAvailable: false,
      parsedCount: 0,
      phase: "Import failed",
      processedCount: 0,
      skippedCount: 0,
      updatedAt: 0,
    };
    try {
      const markup = renderImportPanel();
      expect(markup).toContain("This doesn&#x27;t look like a Pocket export.");
      expect(markup).not.toContain("invalid_source");
    } finally {
      importQueryResult = null;
    }
  });

  test("shows an empty last-import state when there are no imports", () => {
    const markup = renderImportPanel();
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
      const markup = renderImportPanel();
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
    expect(markup).toContain("Importing continues in the background");
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

  test("renders job-level failures without requiring report rows", () => {
    importQueryResult = {
      id: "job",
      mode: "bookmarks",
      status: "failed",
      createdCount: 105,
      failedCount: 1,
      failureClass:
        "Card limit reached. Please upgrade to Pro for unlimited cards.",
      reportAvailable: false,
      parsedCount: 200,
      phase: "Import failed",
      processedCount: 106,
      skippedCount: 0,
      updatedAt: 0,
    };
    try {
      const markup = renderImportPanel();
      expect(markup).toContain("Import stopped");
      expect(markup).toContain(
        "Card limit reached. Please upgrade to Pro for unlimited cards."
      );
    } finally {
      importQueryResult = null;
    }
  });

  test("explains why each failed item could not be imported", () => {
    importQueryResult = {
      id: "job",
      mode: "bookmarks",
      status: "completed",
      createdCount: 1,
      failedCount: 1,
      reportAvailable: true,
      parsedCount: 2,
      phase: "Import complete",
      processedCount: 2,
      skippedCount: 0,
      updatedAt: 0,
    };
    failureSamplesResult = [
      {
        item: "Run me",
        reason: "Bookmark URL is unsafe",
        sourceIndex: 1,
      },
    ];
    try {
      const markup = renderImportPanel();
      expect(markup).toContain("1 failed");
      expect(markup).toContain("Items that couldn&#x27;t be imported");
      expect(markup).toContain("Run me");
      expect(markup).toContain("Bookmark URL is unsafe");
    } finally {
      importQueryResult = null;
      failureSamplesResult = undefined;
    }
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
          controllers,
          mock()
        )
      ).rejects.toThrow("Upload part 1 failed (500)");
      expect(uploadFetch).toHaveBeenCalledTimes(5);
      expect(controllers.size).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("retries transient multipart upload failures", async () => {
    const originalFetch = globalThis.fetch;
    const uploadFetch = mock()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { ETag: '"part-1"' } })
      );
    globalThis.fetch = uploadFetch as typeof fetch;
    const controllers = new Set<AbortController>();
    const onProgress = mock();
    const recordPart = mock(() => Promise.resolve(null));

    try {
      await putParts(
        new File([new Uint8Array([1])], "bookmarks.html"),
        {
          jobId: "job",
          partSize: 1,
          parts: [{ partNumber: 1, url: "https://uploads.example/1" }],
          uploadedParts: [],
        },
        onProgress,
        controllers,
        recordPart
      );
      expect(uploadFetch).toHaveBeenCalledTimes(2);
      expect(recordPart).toHaveBeenCalledWith({
        etag: '"part-1"',
        partNumber: 1,
        size: 1,
      });
      expect(onProgress).toHaveBeenCalledWith(0);
      expect(onProgress).toHaveBeenCalledWith(100);
      expect(controllers.size).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("refuses an uploaded part whose ETag is unreadable, so it is never recorded", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    ) as unknown as typeof fetch;
    const recordPart = mock(() => Promise.resolve(null));

    try {
      await expect(
        putParts(
          new File([new Uint8Array([1])], "bookmarks.html"),
          {
            jobId: "job",
            partSize: 1,
            parts: [{ partNumber: 1, url: "https://uploads.example/1" }],
            uploadedParts: [],
          },
          mock(),
          new Set<AbortController>(),
          recordPart
        )
      ).rejects.toThrow("Upload part 1 returned no ETag");
      expect(recordPart).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
