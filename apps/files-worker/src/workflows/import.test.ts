import { describe, expect, test } from "bun:test";
import {
  importFileKey,
  importReportKey,
  importStagedPartKey,
} from "@teak/convex/import/indexItems";
import { CARD_ERROR_MESSAGES } from "@teak/convex/shared/constants";
import { strToU8, zipSync } from "fflate";
import type { FakeHandler } from "../test/fakeConvex";
import { createFakeQueue } from "../test/fakeQueue";
import { completionReports, createTestRun } from "../test/fakeRun";
import { fakeHttpEtag } from "../test/testsupport";
import { callFilesOp } from "./filesOps";
import { runImport } from "./import";

const USER_PREFIX = "users/0000abcd/cards";
const SOURCE_KEY = `${USER_PREFIX}/upload-pending-v2/import-source/source.zip`;

interface Item {
  _id: string;
  content: string;
  extractedFileKey?: string;
  failureCode?: string;
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
  source?: Uint8Array,
  wrapFetch?: (fetcher: typeof fetch) => typeof fetch
) => {
  const queue = createFakeQueue();
  const test = createTestRun(
    { jobId: "job-1" },
    {
      env: { OBJECT_DELETIONS: queue.queue as never },
      handlers: backend.handlers,
      instanceId: "import-job-1",
      wrapFetch,
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

interface Staged {
  cursor: number | null;
  offset: number;
  pages: number;
  part: number;
  parts: number;
}

/** A Convex fake for jobs that stage their items in R2. */
const stagedBackend = (job: Record<string, unknown> = {}) => {
  const backend = importBackend({
    parsedCount: 0,
    processedCount: 0,
    stagedItems: { cursor: 0, offset: 0, pages: 0, part: 1, parts: 0 },
    ...job,
  });
  const { handlers, items, state } = backend;
  const counts = state as unknown as Record<string, number>;
  let createStaged = (batch: Item[]) => ({
    consumed: batch.length,
    result: { limitReached: false } as Record<string, unknown>,
  });
  handlers["import/staging:recordFailures"] = ({ items: failed }) => {
    for (const item of failed as Item[]) {
      if (!items.some((entry) => entry.sourceIndex === item.sourceIndex)) {
        items.push({
          ...item,
          _id: `item-${String(item.sourceIndex)}`,
          status: "failed",
        });
      }
    }
    return null;
  };
  handlers["import/staging:recordPage"] = (args) => {
    const current = state.stagedItems as Staged;
    const page = args.page as number;
    if (current.pages >= page) {
      return null;
    }
    if (current.pages !== page - 1 || current.cursor !== args.cursor) {
      throw new Error("staged_page_out_of_order");
    }
    const skipped = args.skipped as number;
    const failed = args.failed as number;
    counts.parsedCount += args.parsed as number;
    counts.processedCount += skipped + failed;
    counts.skippedCount += skipped;
    counts.failedCount += failed;
    state.stagedItems = {
      ...current,
      cursor: args.nextCursor as number | null,
      pages: page,
      parts: current.parts + (args.parts as number),
    };
    return null;
  };
  handlers["import/staging:createBatch"] = (args) => {
    const current = state.stagedItems as Staged;
    const from = args.from as { offset: number; part: number };
    if (
      state.cancelRequested ||
      current.part !== from.part ||
      current.offset !== from.offset
    ) {
      return { limitReached: false };
    }
    const batch = args.items as Item[];
    const { consumed, result } = createStaged(batch);
    for (const item of batch.slice(0, consumed)) {
      if (item.failureCode) {
        items.push({
          ...item,
          _id: `item-${String(item.sourceIndex)}`,
          status: "failed",
        });
        counts.failedCount += 1;
      } else {
        backend.created.push(item.content);
        counts.createdCount += 1;
      }
    }
    state.stagedItems = {
      ...current,
      offset: (args.offset as number) + consumed,
      part: args.part as number,
    };
    return result;
  };
  return {
    ...backend,
    setCreateStaged: (next: typeof createStaged) => {
      createStaged = next;
    },
  };
};

/** Answers the first call to `name` as lost, after Convex ran it. */
const loseResponseOnce =
  (name: string) =>
  (fetcher: typeof fetch): typeof fetch => {
    let lost = false;
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetcher(input, init);
      const called = (JSON.parse(String(init?.body)) as { name: string }).name;
      if (!lost && called === name) {
        lost = true;
        return new Response("upstream lost", { status: 503 });
      }
      return response;
    }) as typeof fetch;
  };

const partKey = (part: number) =>
  importStagedPartKey(USER_PREFIX, "job-1", part);

const writtenParts = (test: ReturnType<typeof setup>) =>
  test.bucket.puts
    .filter((put) => put.key.includes("/staged/"))
    .map((put) => ({
      contents: (
        JSON.parse(new TextDecoder().decode(put.bytes)) as { items: Item[] }
      ).items.map((item) => item.content),
      key: put.key,
    }));

const stageParts = (
  test: ReturnType<typeof setup>,
  parts: Omit<Item, "_id" | "status">[][]
) => {
  for (const [index, items] of parts.entries()) {
    test.bucket.objects.set(partKey(index + 1), {
      bytes: strToU8(JSON.stringify({ items })),
    });
  }
};

const note = (index: number) => ({
  content: `Note ${String(index)}`,
  sourceIndex: index,
  type: "text",
});

const pdfCard = {
  content: "",
  file: {
    fileName: "paper.pdf",
    mimeType: "application/pdf",
    path: "files/paper.pdf",
  },
  type: "document",
};

describe("runImport with items staged in R2", () => {
  test("stages the archive's items in R2 instead of Convex, creates their cards, then deletes the staged part", async () => {
    const backend = stagedBackend();
    const pdf = strToU8("%PDF-1.4 fake");
    const test = setup(
      backend,
      archive(
        [
          { content: "A note", type: "text" },
          pdfCard,
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

    expect(writtenParts(test)).toEqual([
      { contents: ["A note", "", "# Notes"], key: partKey(1) },
    ]);
    expect(test.callsTo("dataImport:insertItems")).toHaveLength(0);
    expect(test.callsTo("dataImport:getPendingItems")).toHaveLength(0);
    expect(backend.created).toEqual(["A note", "", "# Notes"]);
    expect(backend.items).toMatchObject([
      { content: "Broken", sourceIndex: 3, status: "failed" },
    ]);
    expect(backend.state).toMatchObject({
      createdCount: 3,
      failedCount: 1,
      parsedCount: 4,
      processedCount: 1,
      reportKey: importReportKey(USER_PREFIX, "job-1"),
      skippedCount: 0,
      stagedItems: { cursor: null, pages: 1, parts: 1 },
      status: "completed",
    });
    const fileKey = importFileKey(USER_PREFIX, "job-1", "item-1", "paper.pdf");
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
    expect(test.deletedKeys()).toEqual([SOURCE_KEY, partKey(1)]);
    expect(completionReports(test.callsTo)).toEqual(["complete"]);
  });

  test("a link repeated on a later source page, even under another address, is skipped as a duplicate", async () => {
    const backend = stagedBackend();
    const cards = Array.from({ length: 101 }, (_, index) => ({
      content: `Link ${String(index)}`,
      type: "link",
      url:
        index === 100
          ? "http://www.example.com/0/?utm_source=x#top"
          : `https://example.com/${String(index)}`,
    }));
    const test = setup(backend, archive(cards));

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "completed",
    });

    expect(backend.state).toMatchObject({
      createdCount: 100,
      parsedCount: 101,
      processedCount: 1,
      skippedCount: 1,
      stagedItems: { pages: 2, parts: 1 },
    });
    expect(backend.created).not.toContain("Link 100");
    expect(writtenParts(test).map((part) => part.key)).toEqual([partKey(1)]);
  });

  test("an index page whose answer was lost counts its items once and writes the same part", async () => {
    const backend = stagedBackend();
    const test = setup(
      backend,
      archive([
        { content: "First", type: "text" },
        { content: "Broken", type: "not-a-type" },
        { content: "Second", type: "text" },
      ]),
      loseResponseOnce("import/staging:recordPage")
    );

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "completed",
    });

    expect(
      test.steps.records.find((record) => record.name === "index page 1")
    ).toMatchObject({ attempts: 2, outcome: "ok" });
    expect(backend.state).toMatchObject({
      createdCount: 2,
      failedCount: 1,
      parsedCount: 3,
      stagedItems: { pages: 1, parts: 1 },
    });
    expect(backend.items).toHaveLength(1);
    expect(new Set(writtenParts(test).map((part) => part.key))).toEqual(
      new Set([partKey(1)])
    );
    expect(backend.created).toEqual(["First", "Second"]);
  });

  test("a card batch whose answer was lost is not created twice", async () => {
    const backend = stagedBackend({
      stagedItems: { cursor: null, offset: 0, pages: 1, part: 1, parts: 1 },
      status: "importing",
    });
    const test = setup(
      backend,
      undefined,
      loseResponseOnce("import/staging:createBatch")
    );
    stageParts(test, [Array.from({ length: 7 }, (_, index) => note(index))]);

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "completed",
    });

    expect(backend.created).toEqual(
      Array.from({ length: 7 }, (_, index) => `Note ${String(index)}`)
    );
  });

  test("a job already importing carries on from its staged position, across parts", async () => {
    const backend = stagedBackend({
      stagedItems: { cursor: null, offset: 2, pages: 2, part: 1, parts: 3 },
      status: "importing",
    });
    const test = setup(backend);
    stageParts(test, [[note(0), note(1)], [], [note(2), note(3)]]);

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "completed",
    });

    expect(backend.created).toEqual(["Note 2", "Note 3"]);
    expect(test.callsTo("dataImport:setPhase")).toHaveLength(0);
    expect(test.deletedKeys()).toEqual([
      SOURCE_KEY,
      partKey(1),
      partKey(2),
      partKey(3),
    ]);
  });

  test("a new run of a job that was indexing stages its last page again and carries on", async () => {
    const backend = stagedBackend({
      parsedCount: 100,
      stagedItems: { cursor: 100, offset: 0, pages: 1, part: 1, parts: 1 },
      status: "parsing",
    });
    const cards = Array.from({ length: 150 }, (_, index) => ({
      content: `Card ${String(index)}`,
      type: "link",
      url: `https://example.com/${String(index === 120 ? 5 : index)}`,
    }));
    // The earlier run recorded page 1 but never wrote its part.
    const test = setup(backend, archive(cards));

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "completed",
    });

    expect(test.steps.names()).toContain("resume staged index");
    expect(backend.state).toMatchObject({
      parsedCount: 150,
      skippedCount: 1,
      stagedItems: { pages: 2, parts: 2 },
    });
    expect(backend.created).toHaveLength(149);
    expect(backend.created).not.toContain("Card 120");
  });

  test("waits out the card rate limit and carries on after the cards already made", async () => {
    const backend = stagedBackend({
      stagedItems: { cursor: null, offset: 0, pages: 1, part: 1, parts: 1 },
      status: "importing",
    });
    let limited = true;
    backend.setCreateStaged((batch) => {
      if (limited) {
        limited = false;
        return {
          consumed: 2,
          result: { limitReached: false, retryAt: Date.now() + 30_000 },
        };
      }
      return { consumed: batch.length, result: { limitReached: false } };
    });
    const test = setup(backend);
    stageParts(test, [Array.from({ length: 4 }, (_, index) => note(index))]);

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "completed",
    });

    expect(test.steps.sleeps.map((sleep) => sleep.name)).toEqual([
      "card rate limit 1",
    ]);
    expect(backend.created).toEqual(["Note 0", "Note 1", "Note 2", "Note 3"]);
  });

  test("a file that can't be extracted is recorded as failed with its reason", async () => {
    const backend = stagedBackend();
    backend.handlers["storage/ownership:registerObject"] = () => false;
    const test = setup(
      backend,
      archive([{ content: "A note", type: "text" }, pdfCard], {
        "files/paper.pdf": strToU8("%PDF-1.4 fake"),
      })
    );

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "completed",
    });

    expect(backend.created).toEqual(["A note"]);
    expect(backend.items).toMatchObject([
      {
        extractedFileKey: importFileKey(
          USER_PREFIX,
          "job-1",
          "item-1",
          "paper.pdf"
        ),
        failureCode: "FILE_EXTRACT_FAILED",
        failureReason: "account_storage_write_denied",
        sourceIndex: 1,
      },
    ]);
  });

  test("a file extraction the Files Worker says to retry is retried, then imported", async () => {
    const backend = stagedBackend();
    const pdf = strToU8("%PDF-1.4 fake");
    const test = setup(
      backend,
      archive([{ content: "A note", type: "text" }, pdfCard], {
        "files/paper.pdf": pdf,
      })
    );
    let refusals = 1;

    expect(
      await runImport(test.run, {
        convex: test.convex,
        ops: (spec) => {
          if (spec.op === "extract-import-files" && refusals > 0) {
            refusals -= 1;
            return Promise.reject(
              Object.assign(new Error("files_worker_error:INTERNAL:500:r"), {
                retryable: true,
              })
            );
          }
          return callFilesOp(test.env, spec);
        },
      })
    ).toEqual({ status: "completed" });

    expect(backend.created).toEqual(["A note", ""]);
    expect(backend.items).toEqual([]);
    expect(
      test.bucket.storedBytes(
        importFileKey(USER_PREFIX, "job-1", "item-1", "paper.pdf")
      )
    ).toEqual(pdf);
  });

  test("a file extraction that keeps failing fails only its items", async () => {
    const backend = stagedBackend();
    const test = setup(
      backend,
      archive([{ content: "A note", type: "text" }, pdfCard], {
        "files/paper.pdf": strToU8("%PDF-1.4 fake"),
      })
    );

    expect(
      await runImport(test.run, {
        convex: test.convex,
        ops: (spec) =>
          spec.op === "extract-import-files"
            ? Promise.reject(
                Object.assign(new Error("files_worker_error:INTERNAL:500:r"), {
                  retryable: true,
                })
              )
            : callFilesOp(test.env, spec),
      })
    ).toEqual({ status: "completed" });

    expect(backend.created).toEqual(["A note"]);
    expect(backend.items).toMatchObject([
      { failureCode: "FILE_EXTRACT_FAILED", sourceIndex: 1 },
    ]);
  });

  test("a cancel between card batches finishes canceled and deletes the staged parts", async () => {
    const backend = stagedBackend({
      stagedItems: { cursor: null, offset: 0, pages: 1, part: 1, parts: 2 },
      status: "importing",
    });
    backend.setCreateStaged((batch) => {
      backend.state.cancelRequested = true;
      return { consumed: batch.length, result: { limitReached: false } };
    });
    const test = setup(backend);
    stageParts(test, [
      Array.from({ length: 8 }, (_, index) => note(index)),
      [note(8)],
    ]);

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "canceled",
    });

    expect(backend.created).toHaveLength(5);
    expect(backend.state).toMatchObject({
      stagedItems: { offset: 5, part: 1 },
      status: "canceled",
    });
    expect(test.deletedKeys()).toEqual([SOURCE_KEY, partKey(1), partKey(2)]);
  });

  test("a run that stops before creating an extracted file's card deletes the file", async () => {
    const backend = stagedBackend({
      stagedItems: { cursor: null, offset: 0, pages: 1, part: 1, parts: 1 },
      status: "importing",
    });
    backend.setCreateStaged(() => ({
      consumed: 0,
      result: {
        failureClass: "identity_mapping_unavailable",
        limitReached: false,
      },
    }));
    const test = setup(
      backend,
      archive([], { "files/paper.pdf": strToU8("%PDF-1.4 fake") })
    );
    stageParts(test, [
      [
        {
          content: "",
          fileName: "paper.pdf",
          filePath: "files/paper.pdf",
          mimeType: "application/pdf",
          sourceIndex: 0,
          type: "document",
        },
      ],
    ]);

    expect(await runImport(test.run, { convex: test.convex })).toEqual({
      status: "failed",
    });

    const fileKey = importFileKey(USER_PREFIX, "job-1", "item-0", "paper.pdf");
    expect(test.bucket.storedBytes(fileKey)).not.toBeNull();
    expect(test.deletedKeys()).toEqual([SOURCE_KEY, fileKey, partKey(1)]);
    expect(backend.state).toMatchObject({
      failureClass: "identity_mapping_unavailable",
      status: "failed",
    });
  });
});
