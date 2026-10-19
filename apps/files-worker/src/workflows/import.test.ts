import { describe, expect, test } from "bun:test";
import { importFileKey, importReportKey } from "@teak/convex/import/indexItems";
import { CARD_ERROR_MESSAGES } from "@teak/convex/shared/constants";
import { strToU8, zipSync } from "fflate";
import type { FakeHandler } from "../test/fakeConvex";
import { createFakeQueue } from "../test/fakeQueue";
import { completionReports, createTestRun } from "../test/fakeRun";
import { fakeHttpEtag } from "../test/testsupport";
import { runImport } from "./import";

const USER_PREFIX = "users/0000abcd/cards";
const SOURCE_KEY = `${USER_PREFIX}/upload-pending-v2/import-source/source.zip`;

interface Item {
  _id: string;
  content: string;
  extractedFileKey?: string;
  failureReason?: string;
  fileName?: string;
  filePath?: string;
  mimeType?: string;
  sourceIndex: number;
  status: string;
  type: string;
  url?: string;
}

const importBackend = (job: Record<string, unknown> = {}) => {
  const state = {
    cancelRequested: false,
    createdCount: 0,
    failedCount: 0,
    fileSize: 0,
    mode: "archive",
    skippedCount: 0,
    sourceKey: SOURCE_KEY,
    status: "queued",
    userId: "u1",
    userKeyPrefix: USER_PREFIX,
    ...job,
  } as Record<string, unknown> & { failedCount: number };
  const items: Item[] = [];
  const owned: string[] = [];
  const created: string[] = [];
  let createBatch: (ids: string[]) => Record<string, unknown> = (ids) => {
    for (const id of ids) {
      const item = items.find((entry) => entry._id === id);
      if (item?.status === "pending") {
        item.status = "created";
        created.push(item.content);
        state.createdCount = (state.createdCount as number) + 1;
      }
    }
    return { limitReached: false };
  };
  const handlers: Record<string, FakeHandler> = {
    "dataImport:createPendingBatch": ({ itemIds }) =>
      createBatch(itemIds as string[]),
    "dataImport:failItems": ({ itemIds, code, reason }) => {
      for (const id of itemIds as string[]) {
        const item = items.find((entry) => entry._id === id);
        if (item?.status === "pending") {
          Object.assign(item, { failureCode: code, failureReason: reason });
          item.status = "failed";
          state.failedCount += 1;
        }
      }
      return null;
    },
    "dataImport:finishJob": (args) => {
      Object.assign(state, args);
      return null;
    },
    "dataImport:getFailureReportRows": () => ({
      continueCursor: "",
      isDone: true,
      page: items.filter((item) => item.status === "failed"),
    }),
    "dataImport:getPendingItems": ({ limit }) =>
      items
        .filter((item) => item.status === "pending")
        .slice(0, limit as number),
    "dataImport:getUnclaimedFileKeysPage": () => ({
      continueCursor: "",
      isDone: true,
      keys: items.flatMap((item) =>
        item.status !== "created" && item.extractedFileKey
          ? [item.extractedFileKey]
          : []
      ),
    }),
    "dataImport:getWorkflowJob": () => ({ ...state }),
    "dataImport:insertItems": ({ items: inserted }) => {
      for (const item of inserted as Item[]) {
        if (!items.some((entry) => entry.sourceIndex === item.sourceIndex)) {
          items.push({ ...item, _id: `item-${String(item.sourceIndex)}` });
          if (item.status === "failed") {
            state.failedCount += 1;
          }
        }
      }
      return null;
    },
    "dataImport:setExtractedFile": ({ itemId, key }) => {
      const item = items.find((entry) => entry._id === itemId);
      if (item) {
        item.extractedFileKey = key as string;
      }
      return null;
    },
    "dataImport:setPhase": ({ status }) => {
      if (state.cancelRequested) {
        return { canceled: true };
      }
      state.status = status;
      return { canceled: false };
    },
    "import/sourceVersion:bind": ({ sourceEtag }) => {
      state.sourceEtag = sourceEtag;
      return sourceEtag;
    },
    "storage/ownership:registerObject": ({ key }) => {
      owned.push(key as string);
      return true;
    },
  };
  return {
    created,
    handlers,
    items,
    owned,
    setCreateBatch: (next: typeof createBatch) => {
      createBatch = next;
    },
    state,
  };
};

const pendingItem = (index: number): Item => ({
  _id: `item-${String(index)}`,
  content: `Note ${String(index)}`,
  sourceIndex: index,
  status: "pending",
  type: "text",
});

const setup = (
  backend: ReturnType<typeof importBackend>,
  source?: Uint8Array
) => {
  const queue = createFakeQueue();
  const test = createTestRun(
    { jobId: "job-1" },
    {
      env: { OBJECT_DELETIONS: queue.queue as never },
      handlers: backend.handlers,
      instanceId: "import-job-1",
    }
  );
  if (source) {
    test.bucket.objects.set(SOURCE_KEY, { bytes: source });
    backend.state.fileSize = source.length;
  }
  const deletedKeys = () =>
    queue.sent.flatMap((message) => (message.body as { keys: string[] }).keys);
  return { ...test, deletedKeys };
};

const archive = (
  cards: unknown[],
  files: Record<string, Uint8Array> = {}
): Uint8Array =>
  zipSync(
    {
      "manifest.json": strToU8(JSON.stringify({ cards, version: 1 })),
      ...files,
    },
    { level: 0 }
  );

describe("runImport", () => {
  test("imports an archive, extracts its file, then deletes the source and reports failures", async () => {
    const backend = importBackend();
    const pdf = strToU8("%PDF-1.4 fake");
    const test = setup(
      backend,
      archive(
        [
          { content: "A note", type: "text" },
          {
            content: "",
            file: {
              fileName: "paper.pdf",
              mimeType: "application/pdf",
              path: "files/paper.pdf",
            },
            type: "document",
          },
          {
            content: "",
            file: {
              fileName: "notes.md",
              mimeType: "text/markdown",
              path: "files/notes.md",
            },
            type: "document",
          },
          { content: "Broken", type: "not-a-type" },
        ],
        { "files/notes.md": strToU8("# Notes"), "files/paper.pdf": pdf }
      )
    );

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "completed",
    });

    expect(backend.state).toMatchObject({
      reportKey: importReportKey(USER_PREFIX, "job-1"),
      sourceEtag: fakeHttpEtag(
        test.bucket.storedBytes(SOURCE_KEY) as Uint8Array
      ),
      status: "completed",
    });
    expect(backend.state.failureClass).toBeUndefined();
    expect(backend.created).toEqual(["A note", "", "# Notes"]);
    const fileKey = importFileKey(USER_PREFIX, "job-1", "item-1", "paper.pdf");
    expect(backend.items[1]?.extractedFileKey).toBe(fileKey);
    expect(test.bucket.storedBytes(fileKey)).toEqual(pdf);
    expect(backend.owned).toEqual([
      fileKey,
      importReportKey(USER_PREFIX, "job-1"),
    ]);
    const report = new TextDecoder().decode(
      test.bucket.storedBytes(
        importReportKey(USER_PREFIX, "job-1")
      ) as Uint8Array
    );
    expect(report).toContain("Failed: 1");
    expect(report).toContain("4. Broken:");
    expect(test.deletedKeys()).toEqual([SOURCE_KEY]);
    expect(completionReports(test.callsTo)).toEqual(["complete"]);
  });

  test("a cancel while parsing stops reading the source and finishes canceled", async () => {
    const backend = importBackend();
    const cards = Array.from({ length: 150 }, (_, index) => ({
      content: `Card ${String(index)}`,
      type: "text",
    }));
    const insert = backend.handlers["dataImport:insertItems"];
    backend.handlers["dataImport:insertItems"] = (args, request) => {
      backend.state.cancelRequested = true;
      return insert(args, request);
    };
    const test = setup(backend, archive(cards));

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "canceled",
    });

    expect(backend.items).toHaveLength(100);
    expect(backend.created).toEqual([]);
    expect(backend.state.status).toBe("canceled");
  });

  test("a source that changed since it was bound fails without storing items", async () => {
    const backend = importBackend({ sourceEtag: '"before"' });
    const test = setup(backend, archive([{ content: "A note", type: "text" }]));

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "failed",
    });

    expect(backend.items).toEqual([]);
    expect(String(backend.state.failureClass)).toStartWith(
      "files_worker_error:CONFLICT"
    );
  });

  test("a job already importing resumes from its pending items without indexing again", async () => {
    const backend = importBackend({ status: "importing" });
    backend.items.push(pendingItem(0), pendingItem(1));
    const test = setup(backend);

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "completed",
    });

    expect(backend.created).toEqual(["Note 0", "Note 1"]);
    expect(test.callsTo("dataImport:insertItems")).toHaveLength(0);
    expect(test.callsTo("dataImport:setPhase")).toHaveLength(0);
  });

  test("a job that already finished is left alone", async () => {
    const backend = importBackend({ status: "completed" });
    const test = setup(backend);

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "completed",
    });

    expect(test.callsTo("dataImport:finishJob")).toHaveLength(0);
  });

  test("a cancel between card batches finishes the job canceled and keeps the rest pending", async () => {
    const backend = importBackend({ status: "importing" });
    for (let index = 0; index < 8; index += 1) {
      backend.items.push(pendingItem(index));
    }
    backend.setCreateBatch((ids) => {
      for (const id of ids) {
        const item = backend.items.find((entry) => entry._id === id);
        if (item) {
          item.status = "created";
          backend.created.push(item.content);
        }
      }
      backend.state.cancelRequested = true;
      return { limitReached: false };
    });
    const test = setup(backend);

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "canceled",
    });

    expect(backend.created).toHaveLength(5);
    expect(
      backend.items.filter((item) => item.status === "pending")
    ).toHaveLength(3);
    expect(backend.state.status).toBe("canceled");
  });

  test("waits out the card rate limit, then carries on", async () => {
    const backend = importBackend({ status: "importing" });
    backend.items.push(pendingItem(0));
    let limited = true;
    backend.setCreateBatch((ids) => {
      if (limited) {
        limited = false;
        return { limitReached: false, retryAt: Date.now() + 30_000 };
      }
      for (const id of ids) {
        const item = backend.items.find((entry) => entry._id === id);
        if (item) {
          item.status = "created";
          backend.created.push(item.content);
        }
      }
      return { limitReached: false };
    });
    const test = setup(backend);

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "completed",
    });

    expect(test.steps.sleeps).toHaveLength(1);
    expect(test.steps.sleeps[0]?.name).toBe("card rate limit 1");
    expect(test.steps.sleeps[0]?.duration).toBeGreaterThan(25_000);
    expect(backend.created).toEqual(["Note 0"]);
  });

  test("stops at the card limit and fails the job with its message", async () => {
    const backend = importBackend({ status: "importing" });
    backend.items.push(pendingItem(0), pendingItem(1));
    backend.setCreateBatch(() => ({ limitReached: true }));
    const test = setup(backend);

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "failed",
    });

    expect(backend.state).toMatchObject({
      failureClass: CARD_ERROR_MESSAGES.CARD_LIMIT_REACHED,
      status: "failed",
    });
  });

  test("an owner the identity mapping can't resolve fails the job", async () => {
    const backend = importBackend({ status: "importing" });
    backend.items.push(pendingItem(0));
    backend.setCreateBatch(() => ({
      failureClass: "identity_mapping_unavailable",
      limitReached: false,
    }));
    const test = setup(backend);

    await runImport(test.run, { convex: test.convex });

    expect(backend.state).toMatchObject({
      failureClass: "identity_mapping_unavailable",
      status: "failed",
    });
    expect(backend.created).toEqual([]);
  });

  test("a file that isn't the chosen source's export fails the job as invalid", async () => {
    const backend = importBackend({ mode: "pocket" });
    const test = setup(backend, strToU8("not a pocket export"));

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "failed",
    });

    expect(backend.state).toMatchObject({
      failureClass: "invalid_source",
      status: "failed",
    });
    expect(test.deletedKeys()).toEqual([SOURCE_KEY]);
  });

  test("a report that can't be written still finishes the job, after retries", async () => {
    const backend = importBackend({ failedCount: 1, status: "importing" });
    backend.items.push({ ...pendingItem(0), status: "failed" });
    backend.handlers["storage/ownership:registerObject"] = () => false;
    const test = setup(backend);

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "completed",
    });

    expect(backend.state).toMatchObject({
      failureClass: "import_finalization_failed",
      status: "completed",
    });
    expect(backend.state.reportKey).toBeUndefined();
    expect(
      test.steps.records.find(
        (record) => record.name === "finalize import objects"
      )
    ).toMatchObject({ attempts: 3, outcome: "error" });
  });
});
