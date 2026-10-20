import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { unzipSync } from "fflate";
import type { FakeHandler } from "../test/fakeConvex";
import { completionReports, createTestRun } from "../test/fakeRun";
import { createFakeStep } from "../test/fakeStep";
import { makePng } from "../test/testsupport";
import { runExport } from "./export";
import { callFilesOp } from "./filesOps";

const ARTIFACT_KEY = "exports/0123456789abcdef/job-1-2026-10-16.zip";
const MANIFEST_KEY = `${ARTIFACT_KEY}.manifest.json`;

interface FakeCard {
  _id: string;
  aiSummary?: string;
  aiTags?: string[];
  content: string;
  createdAt: number;
  fileKey?: string;
  fileMetadata?: { fileName: string; fileSize: number; mimeType?: string };
  folderIds?: string[];
  isDeleted?: boolean;
  isFavorited?: boolean;
  notes?: string;
  tags?: string[];
  type: string;
  updatedAt: number;
  url?: string;
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

const NEW_SNAPSHOT_FUNCTIONS = [
  "dataExport:getExportSnapshotPage",
  "dataExport:getExportCardsByIds",
];

/**
 * A Convex deployment holding one export job over `cards` (newest first),
 * with both the step-state snapshot and the older `exportJobItems` one.
 */
const exportBackend = (
  cards: FakeCard[],
  options: {
    cancelRequested?: boolean;
    folders?: Array<{ id: string; name: string }>;
    pageSize?: number;
  } = {}
) => {
  const job: Record<string, unknown> = {
    cancelRequested: options.cancelRequested ?? false,
    status: "pending",
  };
  const items: string[] = [];
  const owned: string[] = [];
  const active = (id: string) =>
    cards.find((entry) => entry._id === id && entry.isDeleted !== true);
  const pageOf = (cursor: unknown, numItems: unknown) => {
    const size = options.pageSize ?? (numItems as number);
    const start = Number(cursor ?? 0);
    const page = cards
      .slice(start, start + size)
      .filter((entry) => entry.isDeleted !== true);
    const isDone = start + size >= cards.length;
    return {
      addedBytes: page.reduce(
        (sum, entry) => sum + (entry.fileMetadata?.fileSize ?? 0),
        0
      ),
      cursor: isDone ? null : String(start + size),
      isDone,
      page,
    };
  };
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
    "dataExport:getExportCardsByIds": ({ cardIds }) =>
      (cardIds as string[]).flatMap((id) => {
        const found = active(id);
        return found ? [found] : [];
      }),
    "dataExport:getExportCardsPage": ({ cursor, numItems }) => {
      const start = Number(cursor ?? 0);
      const end = start + (numItems as number);
      return {
        cards: items.slice(start, end).flatMap((id) => {
          const found = active(id);
          return found ? [found] : [];
        }),
        cursor: end >= items.length ? null : String(end),
        isDone: end >= items.length,
      };
    },
    "dataExport:getExportFolderNames": () => options.folders ?? [],
    "dataExport:getExportSnapshotPage": ({ cursor, numItems }) => {
      const { page, ...rest } = pageOf(cursor, numItems);
      return { ...rest, cardIds: page.map((entry) => entry._id) };
    },
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
    "dataExport:recordSnapshotPage": ({ cursor, numItems }) => {
      const { page, ...rest } = pageOf(cursor, numItems);
      items.push(...page.map((entry) => entry._id));
      return { ...rest, addedCount: page.length };
    },
    "storage/ownership:registerObject": ({ key }) => {
      owned.push(key as string);
      return true;
    },
  };
  return { cards, handlers, items, job, owned };
};

/** A Convex deployment from before the snapshot moved to step state. */
const refuseNewSnapshot =
  (fetcher: typeof fetch): typeof fetch =>
  async (input, init) => {
    const { name } = JSON.parse(String(init?.body)) as { name: string };
    return NEW_SNAPSHOT_FUNCTIONS.includes(name)
      ? Response.json({ error: "function_not_allowed" }, { status: 403 })
      : await fetcher(input, init);
  };

const setup = (
  backend: ReturnType<typeof exportBackend>,
  options: {
    handlers?: Record<string, FakeHandler>;
    oldConvex?: boolean;
    step?: ReturnType<typeof createFakeStep>;
  } = {}
) =>
  createTestRun(
    { jobId: "job-1", userId: "u1" },
    {
      handlers: { ...backend.handlers, ...options.handlers },
      instanceId: "export-job-1",
      ...(options.oldConvex ? { wrapFetch: refuseNewSnapshot } : {}),
      ...(options.step ? { step: options.step } : {}),
    }
  );

const archiveEntries = (bytes: Uint8Array) => unzipSync(bytes);

const archiveCards = (bytes: Uint8Array) =>
  JSON.parse(
    new TextDecoder().decode(archiveEntries(bytes)["cards.json"] as Uint8Array)
  ) as {
    cards: Array<{ content: string; file?: { path: string }; id: string }>;
  };

const writesJobItems = (test: ReturnType<typeof setup>) =>
  test.callsTo("dataExport:recordSnapshotPage").length +
  test.callsTo("dataExport:deleteJobItemsPage").length;

afterEach(() => {
  setSystemTime();
});

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
    expect(test.callsTo("dataExport:getExportSnapshotPage")).toHaveLength(0);
    expect(writesJobItems(test)).toBe(0);
    expect(completionReports(test.callsTo)).toEqual(["complete"]);
  });

  test("a library over the card cap fails the job before the archive", async () => {
    const backend = exportBackend([card("c1")]);
    const test = setup(backend, {
      handlers: {
        "dataExport:getExportSnapshotPage": () => ({
          addedBytes: 0,
          cardIds: Array.from({ length: 10_001 }, (_, index) => `c${index}`),
          cursor: null,
          isDone: true,
        }),
      },
    });

    expect(await runExport(test.run, { convex: test.convex })).toEqual({
      status: "failed",
    });

    expect(backend.job).toMatchObject({
      failureClass: "cap_exceeded",
      status: "failed",
    });
    expect(test.bucket.objects.has(ARTIFACT_KEY)).toBe(false);
    expect(writesJobItems(test)).toBe(0);
  });

  test("a cancel between snapshot pages stops before the archive", async () => {
    const backend = exportBackend([card("c1"), card("c2"), card("c3")], {
      pageSize: 1,
    });
    const test = setup(backend, {
      handlers: {
        "dataExport:isCancelRequested": () => {
          backend.job.cancelRequested = true;
          return true;
        },
      },
    });

    expect(await runExport(test.run, { convex: test.convex })).toEqual({
      status: "canceled",
    });

    expect(test.callsTo("dataExport:getExportSnapshotPage")).toHaveLength(1);
    expect(test.callsTo("dataExport:getExportCardsByIds")).toHaveLength(0);
    expect(backend.job.status).toBe("canceled");
  });

  test("builds the archive from a snapshot kept in step state, writing no row per card", async () => {
    const backend = exportBackend(
      [card("c1", "kept.png"), card("c2", "gone.png"), card("c3")],
      { pageSize: 2 }
    );
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
      processedCount: 3,
      stage: "archiving",
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
    expect(
      test.callsTo("dataExport:recordExportProgress").map((call) => call.args)
    ).toEqual([
      { jobId: "job-1", processedCount: 2, stage: "snapshotting" },
      { jobId: "job-1", processedCount: 3, stage: "snapshotting" },
      { jobId: "job-1", stage: "archiving" },
    ]);
    expect(writesJobItems(test)).toBe(0);
    expect(test.steps.names()).not.toContain("delete job items");
    expect(backend.owned).toEqual([
      ARTIFACT_KEY,
      `${ARTIFACT_KEY}.checkpoint.json`,
      `${ARTIFACT_KEY}.result.json`,
      MANIFEST_KEY,
    ]);
    expect(test.bucket.objects.has(MANIFEST_KEY)).toBe(false);
    expect(completionReports(test.callsTo)).toEqual(["complete"]);
  });

  test("a snapshot page retried after a lost reply exports each card once", async () => {
    const backend = exportBackend([card("c1"), card("c2")]);
    let lost = false;
    const test = createTestRun(
      { jobId: "job-1", userId: "u1" },
      {
        handlers: backend.handlers,
        wrapFetch: (fetcher) =>
          (async (input, init) => {
            const response = await fetcher(input, init);
            if (!lost && String(init?.body).includes("getExportSnapshotPage")) {
              lost = true;
              throw new TypeError("connection reset");
            }
            return response;
          }) as typeof fetch,
      }
    );

    await runExport(test.run, { convex: test.convex });

    expect(test.callsTo("dataExport:getExportSnapshotPage")).toHaveLength(2);
    const archive = archiveCards(
      test.bucket.storedBytes(ARTIFACT_KEY) as Uint8Array
    );
    expect(archive.cards.map((entry) => entry.id)).toEqual(["c1", "c2"]);
    expect(backend.job.cardCount).toBe(2);
  });

  test("a resumed run archives the snapshotted cards as they are when the archive is built", async () => {
    const backend = exportBackend([
      card("c4"),
      card("c3"),
      card("c2"),
      card("c1"),
    ]);
    // The run snapshotted c3, c2 and c1 before it was evicted. Since then c4
    // was saved, c2 was edited and c1 was deleted.
    const c2 = backend.cards.find((entry) => entry._id === "c2") as FakeCard;
    c2.content = "edited after the snapshot";
    (backend.cards.find((entry) => entry._id === "c1") as FakeCard).isDeleted =
      true;
    const test = setup(backend, {
      step: createFakeStep({
        results: {
          "mark running": { artifactKey: ARTIFACT_KEY, canceled: false },
          "snapshot page 1": {
            addedBytes: 0,
            addedCount: 3,
            canceled: false,
            cardIds: ["c3", "c2", "c1"],
            cursor: null,
            isDone: true,
          },
        },
      }),
    });

    expect(await runExport(test.run, { convex: test.convex })).toEqual({
      status: "ready",
    });

    expect(test.callsTo("dataExport:getExportSnapshotPage")).toHaveLength(0);
    const archive = archiveCards(
      test.bucket.storedBytes(ARTIFACT_KEY) as Uint8Array
    );
    expect(archive.cards.map((entry) => [entry.id, entry.content])).toEqual([
      ["c3", "card c3"],
      ["c2", "edited after the snapshot"],
    ]);
    expect(backend.job.cardCount).toBe(2);
  });

  test("a run resumed from an older Worker's row snapshot reads and then drains the rows", async () => {
    const backend = exportBackend([card("c1"), card("c2"), card("c3")]);
    backend.items.push("c1", "c2");
    const test = setup(backend, {
      step: createFakeStep({
        results: {
          "mark running": { artifactKey: ARTIFACT_KEY, canceled: false },
          "snapshot page 1": {
            addedBytes: 0,
            addedCount: 2,
            canceled: false,
            cursor: "2",
            isDone: false,
          },
        },
      }),
    });

    expect(await runExport(test.run, { convex: test.convex })).toEqual({
      status: "ready",
    });

    const archive = archiveCards(
      test.bucket.storedBytes(ARTIFACT_KEY) as Uint8Array
    );
    expect(archive.cards.map((entry) => entry.id)).toEqual(["c1", "c2", "c3"]);
    expect(test.callsTo("dataExport:getExportSnapshotPage")).toHaveLength(1);
    expect(test.steps.names()).toContain("delete job items");
    expect(backend.items).toEqual([]);
  });

  test("before Convex has the snapshot query, the run snapshots into rows and drains them", async () => {
    const backend = exportBackend([card("c1"), card("c2")]);
    const test = setup(backend, { oldConvex: true });

    expect(await runExport(test.run, { convex: test.convex })).toEqual({
      status: "ready",
    });

    expect(test.callsTo("dataExport:recordSnapshotPage")).toHaveLength(1);
    const archive = archiveCards(
      test.bucket.storedBytes(ARTIFACT_KEY) as Uint8Array
    );
    expect(archive.cards.map((entry) => entry.id)).toEqual(["c1", "c2"]);
    expect(backend.job).toMatchObject({ cardCount: 2, status: "ready" });
    expect(backend.items).toEqual([]);
  });

  test("a row snapshot that fails the job is drained too", async () => {
    const backend = exportBackend([card("c1")]);
    const test = setup(backend, {
      handlers: {
        "dataExport:recordSnapshotPage": () => {
          backend.items.push("c1");
          return {
            addedBytes: 0,
            addedCount: 10_001,
            cursor: null,
            isDone: true,
          };
        },
      },
      oldConvex: true,
    });

    expect(await runExport(test.run, { convex: test.convex })).toEqual({
      status: "failed",
    });

    expect(backend.job).toMatchObject({ failureClass: "cap_exceeded" });
    expect(backend.items).toEqual([]);
  });

  test("the archive and its manifest match the row snapshot's byte for byte", async () => {
    const seeded = (): FakeCard[] => [
      {
        ...card("c5", "photo one.png"),
        aiSummary: "A tiny square",
        aiTags: ["square"],
        folderIds: ["f1", "f2"],
        isFavorited: true,
        notes: 'first, "quoted"',
        tags: ["design", "secret"],
      },
      { ...card("c4"), content: "Line one\nLine two", tags: ["a,b"] },
      { ...card("c3"), isDeleted: true },
      {
        ...card("c2"),
        content: "https://example.com/page",
        type: "link",
        url: "https://example.com/page",
      },
      { ...card("c1", "missing.pdf"), type: "document" },
    ];
    const folders = [
      { id: "f1", name: "Work" },
      { id: "f2", name: "Ideas" },
    ];
    const build = async (oldConvex: boolean) => {
      setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
      const backend = exportBackend(seeded(), { folders, pageSize: 2 });
      const test = setup(backend, { oldConvex });
      test.bucket.objects.set("users/u1/cards/c5/file/photo one.png", {
        bytes: makePng(2, 2),
      });
      await runExport(test.run, { convex: test.convex });
      return {
        artifact: test.bucket.storedBytes(ARTIFACT_KEY) as Uint8Array,
        job: backend.job,
        manifests: test.bucket.puts
          .filter((put) => put.key === MANIFEST_KEY)
          .map((put) => new TextDecoder().decode(put.bytes)),
      };
    };

    const rows = await build(true);
    const stepState = await build(false);

    expect(stepState.manifests).toEqual(rows.manifests);
    expect(stepState.manifests).toHaveLength(2);
    expect(stepState.artifact).toEqual(rows.artifact);
    const entries = archiveEntries(stepState.artifact);
    expect(Object.keys(entries)).toEqual([
      "manifest.json",
      "cards.json",
      "bookmarks.html",
      "cards.csv",
      "files/c5-photo-one.png",
    ]);
    expect(stepState.job).toEqual(rows.job);
    expect(stepState.job).toMatchObject({
      cardCount: 4,
      filesIncluded: 1,
      filesOmitted: 1,
    });
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
    expect(test.bucket.objects.has(MANIFEST_KEY)).toBe(false);
  });

  test("an unexpected failure fails the job and reports the run errored", async () => {
    const backend = exportBackend([card("c1")]);
    const test = setup(backend, {
      handlers: {
        "dataExport:completeExport": () => {
          throw new Error("database unavailable");
        },
      },
    });

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
