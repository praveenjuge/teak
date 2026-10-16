import { describe, expect, test } from "bun:test";
import { unzipSync } from "fflate";
import type { FakeHandler } from "../test/fakeConvex";
import { completionReports, createTestRun } from "../test/fakeRun";
import { createFakeStep } from "../test/fakeStep";
import { makePng } from "../test/testsupport";
import { runExport } from "./export";
import { callFilesOp } from "./filesOps";

const ARTIFACT_KEY = "exports/0123456789abcdef/job-1-2026-10-16.zip";

interface FakeCard {
  _id: string;
  content: string;
  createdAt: number;
  fileKey?: string;
  fileMetadata?: { fileName: string; fileSize: number };
  type: string;
  updatedAt: number;
}

const card = (id: string, fileName?: string): FakeCard => ({
  _id: id,
  content: `card ${id}`,
  createdAt: 1,
  type: fileName ? "image" : "text",
  updatedAt: 1,
  ...(fileName
    ? {
        fileKey: `users/u1/cards/${id}/file/${fileName}`,
        fileMetadata: { fileName, fileSize: 10 },
      }
    : {}),
});

/** Convex's export job, item snapshot and card reads, in memory. */
const exportBackend = (
  cards: FakeCard[],
  options: { cancelRequested?: boolean; pageSize?: number } = {}
) => {
  const job: Record<string, unknown> = {
    cancelRequested: options.cancelRequested ?? false,
    status: "pending",
  };
  const items: string[] = [];
  const owned: string[] = [];
  const handlers: Record<string, FakeHandler> = {
    "dataExport:completeExport": (args) => {
      Object.assign(job, args, { status: "ready" });
      return null;
    },
    "dataExport:deleteJobItemsPage": ({ numItems }) => {
      const deleted = items.splice(0, numItems as number).length;
      return { deleted, hasMore: deleted === numItems };
    },
    "dataExport:failExport": ({ failureClass }) => {
      job.status = failureClass === "canceled" ? "canceled" : "failed";
      job.failureClass = failureClass;
      return null;
    },
    "dataExport:getExportCardsPage": ({ cursor, numItems }) => {
      const start = Number(cursor ?? 0);
      const end = start + (numItems as number);
      return {
        cards: items
          .slice(start, end)
          .map((id) => cards.find((entry) => entry._id === id)),
        cursor: end >= items.length ? null : String(end),
        isDone: end >= items.length,
      };
    },
    "dataExport:getExportFolderNames": () => [],
    "dataExport:isCancelRequested": () => job.cancelRequested,
    "dataExport:markRunning": () => {
      if (job.cancelRequested) {
        return { canceled: true };
      }
      job.status = "running";
      return { artifactKey: ARTIFACT_KEY, canceled: false };
    },
    "dataExport:recordExportProgress": ({ processedCount, stage }) => {
      Object.assign(job, {
        ...(processedCount === undefined ? {} : { processedCount }),
        ...(stage === undefined ? {} : { stage }),
      });
      return null;
    },
    "dataExport:recordSnapshotPage": ({ cursor }) => {
      const size = options.pageSize ?? cards.length;
      const start = Number(cursor ?? 0);
      const page = cards.slice(start, start + size);
      items.push(...page.map((entry) => entry._id));
      const isDone = start + size >= cards.length;
      return {
        addedBytes: page.reduce(
          (sum, entry) => sum + (entry.fileMetadata?.fileSize ?? 0),
          0
        ),
        addedCount: page.length,
        cursor: isDone ? null : String(start + size),
        isDone,
      };
    },
    "storage/ownership:registerObject": ({ key }) => {
      owned.push(key as string);
      return true;
    },
  };
  return { handlers, items, job, owned };
};

const setup = (
  backend: ReturnType<typeof exportBackend>,
  overrides: Record<string, FakeHandler> = {}
) =>
  createTestRun(
    { jobId: "job-1", userId: "u1" },
    {
      handlers: { ...backend.handlers, ...overrides },
      instanceId: "export-job-1",
    }
  );

const archiveCards = (bytes: Uint8Array) => {
  const entries = unzipSync(bytes);
  return JSON.parse(
    new TextDecoder().decode(entries["cards.json"] as Uint8Array)
  ) as { cards: Array<{ file?: { path: string }; id: string }> };
};

describe("runExport", () => {
  test("a job canceled before it starts ends canceled without a snapshot", async () => {
    const backend = exportBackend([card("c1")], { cancelRequested: true });
    const test = setup(backend);

    expect(await runExport(test.run, { convex: test.convex })).toEqual({
      status: "canceled",
    });

    expect(backend.job).toMatchObject({
      failureClass: "canceled",
      status: "canceled",
    });
    expect(test.callsTo("dataExport:recordSnapshotPage")).toHaveLength(0);
    expect(completionReports(test.callsTo)).toEqual(["complete"]);
  });

  test("a library over the card cap fails the job and drops the snapshot", async () => {
    const backend = exportBackend([card("c1")]);
    const test = setup(backend, {
      "dataExport:recordSnapshotPage": () => {
        backend.items.push("c1");
        return {
          addedBytes: 0,
          addedCount: 10_001,
          cursor: null,
          isDone: true,
        };
      },
    });

    expect(await runExport(test.run, { convex: test.convex })).toEqual({
      status: "failed",
    });

    expect(backend.job).toMatchObject({
      failureClass: "cap_exceeded",
      status: "failed",
    });
    expect(backend.items).toEqual([]);
    expect(test.bucket.objects.has(ARTIFACT_KEY)).toBe(false);
  });

  test("a cancel between snapshot pages stops before the archive", async () => {
    const backend = exportBackend([card("c1"), card("c2"), card("c3")], {
      pageSize: 1,
    });
    const test = setup(backend, {
      "dataExport:isCancelRequested": () => {
        backend.job.cancelRequested = true;
        return true;
      },
    });

    expect(await runExport(test.run, { convex: test.convex })).toEqual({
      status: "canceled",
    });

    expect(test.callsTo("dataExport:recordSnapshotPage")).toHaveLength(1);
    expect(backend.job.status).toBe("canceled");
    expect(backend.items).toEqual([]);
  });

  test("builds the archive, leaves out a missing file and completes the job", async () => {
    const backend = exportBackend([
      card("c1", "kept.png"),
      card("c2", "gone.png"),
      card("c3"),
    ]);
    const test = setup(backend);
    test.bucket.objects.set("users/u1/cards/c1/file/kept.png", {
      bytes: makePng(1, 1),
    });

    expect(await runExport(test.run, { convex: test.convex })).toEqual({
      status: "ready",
    });

    expect(backend.job).toMatchObject({
      artifactKey: ARTIFACT_KEY,
      cardCount: 3,
      filesIncluded: 1,
      filesOmitted: 1,
      status: "ready",
    });
    const archive = archiveCards(
      test.bucket.storedBytes(ARTIFACT_KEY) as Uint8Array
    );
    expect(
      archive.cards.map((entry) => [entry.id, entry.file?.path ?? null])
    ).toEqual([
      ["c1", "files/c1-kept.png"],
      ["c2", null],
      ["c3", null],
    ]);
    // Every object the archive writes is registered to its owner first.
    expect(backend.owned).toEqual([
      ARTIFACT_KEY,
      `${ARTIFACT_KEY}.checkpoint.json`,
      `${ARTIFACT_KEY}.result.json`,
      `${ARTIFACT_KEY}.manifest.json`,
    ]);
    expect(test.bucket.objects.has(`${ARTIFACT_KEY}.manifest.json`)).toBe(
      false
    );
    expect(backend.items).toEqual([]);
    expect(completionReports(test.callsTo)).toEqual(["complete"]);
  });

  test("a snapshot page retried after a lost reply exports each card once", async () => {
    const backend = exportBackend([card("c1"), card("c2")]);
    let lost = false;
    const test = createTestRun(
      { jobId: "job-1", userId: "u1" },
      {
        handlers: backend.handlers,
        // The first snapshot page commits, but its reply never arrives.
        wrapFetch: (fetcher) =>
          (async (input, init) => {
            const response = await fetcher(input, init);
            if (!lost && String(init?.body).includes("recordSnapshotPage")) {
              lost = true;
              throw new TypeError("connection reset");
            }
            return response;
          }) as typeof fetch,
      }
    );

    await runExport(test.run, { convex: test.convex });

    expect(test.callsTo("dataExport:recordSnapshotPage")).toHaveLength(2);
    const archive = archiveCards(
      test.bucket.storedBytes(ARTIFACT_KEY) as Uint8Array
    );
    expect(archive.cards.map((entry) => entry.id)).toEqual(["c1", "c2"]);
    expect(backend.job.cardCount).toBe(2);
  });

  test("an archive the build keeps failing fails the job instead of leaving it running", async () => {
    const backend = exportBackend([card("c1")]);
    const test = setup(backend);

    expect(
      await runExport(test.run, {
        convex: test.convex,
        ops: (spec) =>
          spec.op === "build-export"
            ? Promise.reject(new Error("files_worker_error:INTERNAL:500:r"))
            : callFilesOp(test.env, spec),
      })
    ).toEqual({ status: "failed" });

    expect(backend.job).toMatchObject({
      failureClass: "archive_failed",
      status: "failed",
    });
    expect(
      test.steps.records.find((record) => record.name === "build archive")
    ).toMatchObject({ attempts: 3, outcome: "error" });
  });

  test("an unexpected failure fails the job and reports the run errored", async () => {
    const backend = exportBackend([card("c1")]);
    const test = createTestRun(
      { jobId: "job-1", userId: "u1" },
      {
        handlers: {
          ...backend.handlers,
          "dataExport:completeExport": () => {
            throw new Error("database unavailable");
          },
        },
        step: createFakeStep(),
      }
    );

    await expect(runExport(test.run, { convex: test.convex })).rejects.toThrow(
      "database unavailable"
    );

    expect(backend.job).toMatchObject({
      failureClass: "unknown",
      status: "failed",
    });
    expect(completionReports(test.callsTo)).toEqual(["errored"]);
  });
});
