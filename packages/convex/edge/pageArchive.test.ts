import rateLimiterTest from "@convex-dev/rate-limiter/test";
import counterTest from "@convex-dev/sharded-counter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest as baseConvexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { createCardForUserHandler } from "../card/createCard";
import { initializeCardProcessingState } from "../card/processingLifecycle";
import { updateCardFieldForUserHandler } from "../card/updateCard";
import schema from "../schema";
import type { TeakUserId } from "../securitySessions";
import {
  buildR2ObjectKey,
  buildR2UserPrefix,
  PENDING_UPLOAD_CARD_ID,
} from "../storage/r2";
import { queueCardProcessing } from "../workflowDispatch";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.UTC(2026, 9, 20, 10);
const HOUR = 60 * 60 * 1000;
const OWNER = "owner" as TeakUserId;
const OTHER = "other" as TeakUserId;
const LINK = "https://example.com/article";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** A test backend with the components saving a card uses. */
const newBackend = () => {
  const t = baseConvexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  apiKeysTest.register(t);
  counterTest.register(t, "apiKeys/shardedCounter");
  return t;
};

type T = ReturnType<typeof newBackend>;

const snapshotKey = (userId: string, id = "s1") =>
  buildR2ObjectKey({
    userId,
    cardId: PENDING_UPLOAD_CARD_ID,
    role: "page-snapshot",
    objectId: id,
  });

const archiveKey = (userId: string, cardId: string, rev: number) =>
  buildR2ObjectKey({
    userId,
    cardId,
    role: "page-archive",
    objectId: `r${rev}`,
    fileName: "archive.html",
  });

const registerKey = (t: T, userId: string, key: string) =>
  t.run((ctx) => ctx.db.insert("accountStorageObjects", { key, userId }));

const IDLE_STAGES = {
  categorize: { status: "completed" as const },
  classify: { status: "completed" as const },
  metadata: { status: "completed" as const },
  renderables: { status: "completed" as const },
};

const insertCard = (t: T, fields: Partial<Doc<"cards">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("cards", {
      content: LINK,
      createdAt: NOW - HOUR,
      metadataStatus: "completed",
      processingStatus: IDLE_STAGES,
      type: "link",
      updatedAt: NOW - HOUR,
      url: LINK,
      urlKey: "example.com/article",
      userId: OWNER,
      ...fields,
    })
  );

const card = (t: T, cardId: Id<"cards">) =>
  t.run((ctx) => ctx.db.get("cards", cardId)) as Promise<Doc<"cards">>;

const dispatches = (t: T) =>
  t.run((ctx) => ctx.db.query("workflowDispatches").collect());

const cardRuns = async (t: T, cardId?: Id<"cards">) =>
  (await dispatches(t)).filter(
    (row) =>
      row.kind === "cardProcessing" &&
      (cardId === undefined || row.cardId === cardId)
  );

const deletedKeys = async (t: T) =>
  (await dispatches(t))
    .filter((row) => row.kind === "deleteObjects")
    .flatMap((row) => row.keys ?? []);

const create = async (
  t: T,
  args: Parameters<typeof createCardForUserHandler>[2]
) => {
  await seedWorkosOwner(t, OWNER);
  return await t.run((ctx) =>
    createCardForUserHandler(ctx, OWNER, args, { source: "api" })
  );
};

const archiveOf = (cardId: string, rev = 1) => ({
  bytes: 2048,
  capturedAt: NOW - HOUR,
  kind: "full" as const,
  source: "server" as const,
  sourceUrl: LINK,
  storageKey: archiveKey(OWNER, cardId, rev),
});

describe("pageSnapshotKey on a new link", () => {
  test("keeps the caller's own pending snapshot, with when it was taken", async () => {
    const t = newBackend();
    const key = snapshotKey(OWNER);
    await registerKey(t, OWNER, key);

    const { cardId } = await create(t, { content: LINK, pageSnapshotKey: key });

    expect(await card(t, cardId)).toMatchObject({
      pendingPageSnapshotAt: NOW,
      pendingPageSnapshotKey: key,
      processingStatus: { archive: { status: "pending" } },
    });
  });

  test.each([
    {
      name: "another account's snapshot",
      key: () => snapshotKey(OTHER),
      owner: OTHER as string | null,
    },
    {
      name: "a snapshot minted for nobody",
      key: () => snapshotKey(OWNER),
      owner: null,
    },
    {
      name: "the caller's key in another role",
      key: () =>
        buildR2ObjectKey({
          userId: OWNER,
          cardId: PENDING_UPLOAD_CARD_ID,
          role: "file",
          objectId: "f1",
        }),
      owner: OWNER,
    },
    {
      name: "the caller's key on a saved card",
      key: () =>
        buildR2ObjectKey({
          userId: OWNER,
          cardId: "k1",
          role: "page-snapshot",
          objectId: "s1",
        }),
      owner: OWNER,
    },
  ])("ignores $name and still saves", async ({ key, owner }) => {
    const t = newBackend();
    const value = key();
    if (owner) {
      await registerKey(t, owner, value);
    }

    const { cardId, outcome } = await create(t, {
      content: LINK,
      pageSnapshotKey: value,
    });

    expect(outcome).toBe("created");
    const saved = await card(t, cardId);
    expect(saved.pendingPageSnapshotKey).toBeUndefined();
    expect(saved.processingStatus?.archive).toEqual({ status: "pending" });
  });

  test("a note gets no archive stage and no snapshot", async () => {
    const t = newBackend();
    const key = snapshotKey(OWNER);
    await registerKey(t, OWNER, key);

    const { cardId } = await create(t, {
      content: "Just words",
      pageSnapshotKey: key,
      type: "text",
    });

    const saved = await card(t, cardId);
    expect(saved.pendingPageSnapshotKey).toBeUndefined();
    expect(saved.processingStatus?.archive).toBeUndefined();
  });
});

describe("pageSnapshotKey on a re-save", () => {
  test("an idle link archives the new snapshot in a run of its own", async () => {
    const t = newBackend();
    const existing = await insertCard(t, {
      pageArchive: archiveOf("k0"),
      processingStatus: { ...IDLE_STAGES, archive: { status: "completed" } },
    });
    const key = snapshotKey(OWNER);
    await registerKey(t, OWNER, key);

    const result = await create(t, { content: LINK, pageSnapshotKey: key });

    expect(result).toMatchObject({ cardId: existing, outcome: "resaved" });
    expect(await card(t, existing)).toMatchObject({
      pendingPageSnapshotKey: key,
      processingStatus: { archive: { status: "pending" } },
    });
    expect((await cardRuns(t, existing)).map((row) => row.params)).toEqual([
      { archiveOnly: true, cardId: existing, rev: 1 },
    ]);
  });

  test("a link whose run is in flight keeps it, and gets an archive run when it ends", async () => {
    const t = newBackend();
    const existing = await insertCard(t, {
      pageArchive: archiveOf("k0"),
      processingStatus: {
        ...IDLE_STAGES,
        archive: { status: "completed" },
        metadata: { status: "in_progress" },
      },
    });
    const queued = await t.run((ctx) =>
      queueCardProcessing(ctx, existing, { metadataOnly: true })
    );
    await t.mutation(internal.workflowDispatch.claim, {});
    const key = snapshotKey(OWNER);
    await registerKey(t, OWNER, key);

    await create(t, { content: LINK, pageSnapshotKey: key });

    const saved = await card(t, existing);
    expect(saved.pendingPageSnapshotKey).toBe(key);
    expect(saved.processingRev).toBe(1);
    expect(await cardRuns(t, existing)).toHaveLength(1);

    // The metadata-only run never archives, so its end queues the archive.
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: queued?.instanceId as string,
      status: "complete",
    });
    expect((await card(t, existing)).processingStatus?.archive).toMatchObject({
      status: "pending",
    });
    expect((await cardRuns(t, existing)).map((row) => row.params)).toEqual([
      { cardId: existing, metadataOnly: true, rev: 1 },
      { archiveOnly: true, cardId: existing, rev: 2 },
    ]);
  });

  test("AI metadata waiting for its backfill doesn't hold the snapshot back", async () => {
    const t = newBackend();
    const existing = await insertCard(t, {
      pageArchive: archiveOf("k0"),
      processingRev: 1,
      processingStatus: {
        ...IDLE_STAGES,
        archive: { status: "completed" },
        metadata: { status: "pending" },
      },
    });
    const key = snapshotKey(OWNER);
    await registerKey(t, OWNER, key);

    await create(t, { content: LINK, pageSnapshotKey: key });

    expect((await cardRuns(t, existing)).map((row) => row.params)).toEqual([
      { archiveOnly: true, cardId: existing, rev: 2 },
    ]);
  });

  test("a page re-saved while an archive-only run finishes gets a run of its own", async () => {
    const t = newBackend();
    const existing = await insertCard(t, {
      pageArchive: archiveOf("k0"),
      processingStatus: { ...IDLE_STAGES, archive: { status: "pending" } },
    });
    const queued = await t.run((ctx) =>
      queueCardProcessing(ctx, existing, { archiveOnly: true })
    );
    await t.mutation(internal.workflowDispatch.claim, {});
    vi.setSystemTime(NOW + 60_000);
    const key = snapshotKey(OWNER);
    await registerKey(t, OWNER, key);

    await create(t, { content: LINK, pageSnapshotKey: key });
    expect(await cardRuns(t, existing)).toHaveLength(1);
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: queued?.instanceId as string,
      status: "complete",
    });

    expect((await cardRuns(t, existing)).map((row) => row.params)).toEqual([
      { archiveOnly: true, cardId: existing, rev: 1 },
      { archiveOnly: true, cardId: existing, rev: 2 },
    ]);
  });

  test("a run that ends with no new snapshot, or an archive-only run, queues nothing", async () => {
    const t = newBackend();
    const plain = await insertCard(t, { pageArchive: archiveOf("k0") });
    const pending = snapshotKey(OWNER);
    const archiving = await insertCard(t, {
      pendingPageSnapshotAt: NOW,
      pendingPageSnapshotKey: pending,
      url: "https://example.com/other",
      urlKey: "example.com/other",
    });
    const first = await t.run((ctx) => queueCardProcessing(ctx, plain));
    const second = await t.run((ctx) =>
      queueCardProcessing(ctx, archiving, { archiveOnly: true })
    );
    await t.mutation(internal.workflowDispatch.claim, {});

    for (const queued of [first, second]) {
      await t.mutation(internal.workflowDispatch.complete, {
        instanceId: queued?.instanceId as string,
        status: "complete",
      });
    }

    expect(await cardRuns(t, plain)).toHaveLength(1);
    expect(await cardRuns(t, archiving)).toHaveLength(1);
  });

  test("a second snapshot replaces the first, which is deleted", async () => {
    const t = newBackend();
    const first = snapshotKey(OWNER, "first");
    const second = snapshotKey(OWNER, "second");
    const existing = await insertCard(t, {
      pendingPageSnapshotAt: NOW - 1000,
      pendingPageSnapshotKey: first,
    });
    await registerKey(t, OWNER, second);

    await create(t, { content: LINK, pageSnapshotKey: second });

    expect((await card(t, existing)).pendingPageSnapshotKey).toBe(second);
    expect(await deletedKeys(t)).toEqual([first]);
  });
});

describe("editing a link's URL", () => {
  test("drops the old page's copy, snapshot and link check, and archives the new page", async () => {
    const t = newBackend();
    await seedWorkosOwner(t, OWNER);
    const pending = snapshotKey(OWNER);
    const cardId = await insertCard(t, {
      pendingPageSnapshotAt: NOW - 1000,
      pendingPageSnapshotKey: pending,
    });
    const old = archiveOf(cardId);
    await t.run(async (ctx) => {
      await ctx.db.patch("cards", cardId, { pageArchive: old });
      await ctx.db.insert("linkChecks", {
        cardId,
        checkedAt: NOW - 1000,
        outcome: "dead",
        userId: OWNER,
      });
    });

    await t.run((ctx) =>
      updateCardFieldForUserHandler(ctx, {
        cardId,
        field: "url",
        userId: OWNER,
        value: "https://example.org/moved",
      })
    );

    const saved = await card(t, cardId);
    expect(saved.url).toBe("https://example.org/moved");
    expect(saved.pageArchive).toBeUndefined();
    expect(saved.pendingPageSnapshotKey).toBeUndefined();
    expect(saved.pendingPageSnapshotAt).toBeUndefined();
    expect(saved.processingStatus?.archive?.status).toBe("pending");
    expect((await deletedKeys(t)).sort()).toEqual(
      [old.storageKey, pending].sort()
    );
    expect(
      await t.run((ctx) => ctx.db.query("linkChecks").collect())
    ).toHaveLength(0);
    expect(await cardRuns(t, cardId)).toHaveLength(1);
  });

  test("other edits keep the copy and the link check", async () => {
    const t = newBackend();
    await seedWorkosOwner(t, OWNER);
    const cardId = await insertCard(t);
    const old = archiveOf(cardId);
    await t.run(async (ctx) => {
      await ctx.db.patch("cards", cardId, { pageArchive: old });
      await ctx.db.insert("linkChecks", {
        cardId,
        checkedAt: NOW - 1000,
        outcome: "alive",
        userId: OWNER,
      });
    });

    await t.run((ctx) =>
      updateCardFieldForUserHandler(ctx, {
        cardId,
        field: "notes",
        userId: OWNER,
        value: "A note",
      })
    );

    expect((await card(t, cardId)).pageArchive).toEqual(old);
    expect(await deletedKeys(t)).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("linkChecks").collect())
    ).toHaveLength(1);
  });
});

describe("recordPageArchive", () => {
  const record = (
    t: T,
    cardId: Id<"cards">,
    args: {
      archive?: ReturnType<typeof archiveOf>;
      snapshotKey?: string;
    } = {}
  ) =>
    t.mutation(internal.workflows.steps.archive.mutations.recordPageArchive, {
      archive: args.archive ?? archiveOf(cardId, 2),
      cardId,
      durationMs: 1200,
      ...(args.snapshotKey ? { snapshotKey: args.snapshotKey } : {}),
    });

  test("replaces the copy and deletes the old object, never the same one", async () => {
    const t = newBackend();
    const cardId = await insertCard(t, { processingRev: 2 });
    const old = archiveOf(cardId, 1);
    await t.run((ctx) => ctx.db.patch("cards", cardId, { pageArchive: old }));

    await record(t, cardId);
    await record(t, cardId);

    const saved = await card(t, cardId);
    expect(saved.pageArchive).toEqual(archiveOf(cardId, 2));
    expect(saved.processingStatus?.archive?.status).toBe("completed");
    expect(await deletedKeys(t)).toEqual([old.storageKey]);
  });

  test("lets go of the snapshot it was made from", async () => {
    const t = newBackend();
    const key = snapshotKey(OWNER);
    const cardId = await insertCard(t, {
      pendingPageSnapshotAt: NOW,
      pendingPageSnapshotKey: key,
    });

    await record(t, cardId, { snapshotKey: key });

    const saved = await card(t, cardId);
    expect(saved.pendingPageSnapshotKey).toBeUndefined();
    expect(saved.pendingPageSnapshotAt).toBeUndefined();
    expect(await deletedKeys(t)).toEqual([key]);
    expect(await cardRuns(t, cardId)).toEqual([]);
  });

  test("a snapshot sent after the run began stays, and gets a run of its own", async () => {
    const t = newBackend();
    const newer = snapshotKey(OWNER, "newer");
    const cardId = await insertCard(t, {
      pendingPageSnapshotAt: NOW,
      pendingPageSnapshotKey: newer,
    });

    await record(t, cardId);

    expect((await card(t, cardId)).pendingPageSnapshotKey).toBe(newer);
    expect((await cardRuns(t, cardId)).map((row) => row.params)).toEqual([
      { archiveOnly: true, cardId, rev: 1 },
    ]);
  });

  test("refuses a copy outside the owner's storage", async () => {
    const t = newBackend();
    const cardId = await insertCard(t);
    await expect(
      record(t, cardId, {
        archive: {
          ...archiveOf(cardId),
          storageKey: archiveKey(OTHER, cardId, 1),
        },
      })
    ).rejects.toThrow("outside the card owner's storage");
    expect((await card(t, cardId)).pageArchive).toBeUndefined();
  });

  test("sends page_archived, and page_archive_failed when the stage fails", async () => {
    vi.stubEnv("FILES_BASE", "https://files.test");
    vi.stubEnv("FILES_SIGNING_SECRET", "secret");
    vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
    const t = newBackend();
    const archived = await insertCard(t);
    const failed = await insertCard(t);

    await record(t, archived);
    await t.mutation(
      internal.workflows.steps.archive.mutations.markPageArchiveStage,
      {
        cardId: failed,
        reason: "blocked_url",
        source: "extension",
        status: "failed",
      }
    );

    const events = (await dispatches(t))
      .filter((row) => row.kind === "analyticsEvent")
      .map((row) => {
        const params = row.params as {
          event: string;
          properties: Record<string, unknown>;
        };
        return { event: params.event, properties: params.properties };
      });
    expect(events).toEqual([
      {
        event: "page_archived",
        properties: {
          bytes_bucket: "<1MB",
          duration_ms_bucket: "<5s",
          kind: "full",
          source: "server",
          surface: "backend",
        },
      },
      {
        event: "page_archive_failed",
        properties: {
          reason: "blocked_url",
          source: "extension",
          surface: "backend",
        },
      },
    ]);
    expect((await card(t, failed)).processingStatus?.archive).toMatchObject({
      error: "blocked_url",
      status: "failed",
    });
  });
});

describe("runs", () => {
  test("an archive-only run that replaces a pending full run runs in full, and the other way round", async () => {
    const t = newBackend();
    const first = await insertCard(t);
    const second = await insertCard(t);
    await t.run(async (ctx) => {
      await queueCardProcessing(ctx, first);
      await queueCardProcessing(ctx, first, { archiveOnly: true });
      await queueCardProcessing(ctx, second, { archiveOnly: true });
      await queueCardProcessing(ctx, second);
    });

    const claimed = await t.mutation(internal.workflowDispatch.claim, {});

    expect(
      claimed.map(
        ({ item }: { item: unknown }) => (item as { params: unknown }).params
      )
    ).toEqual([
      { cardId: first, rev: 2 },
      { cardId: second, rev: 2 },
    ]);
  });

  test("a link whose run fails keeps its archive stage and gets an archive-only run", async () => {
    const t = newBackend();
    const cardId = await insertCard(t, {
      processingStatus: {
        ...IDLE_STAGES,
        archive: { status: "pending" },
        metadata: { status: "in_progress" },
      },
    });
    const queued = await t.run((ctx) => queueCardProcessing(ctx, cardId));
    await t.mutation(internal.workflowDispatch.claim, {});

    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: queued?.instanceId as string,
      status: "errored",
    });

    expect((await card(t, cardId)).processingStatus).toMatchObject({
      archive: { status: "pending" },
      metadata: { error: "workflow_failed", status: "failed" },
    });
    const runs = await cardRuns(t, cardId);
    expect(runs.map((row) => row.params)).toEqual([
      { cardId, rev: 1 },
      { archiveOnly: true, cardId, rev: 2 },
    ]);

    // That run failing too fails only the archive, and queues nothing more.
    await t.mutation(internal.workflowDispatch.claim, {});
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: runs[1]?.instanceId as string,
      status: "errored",
    });
    expect((await card(t, cardId)).processingStatus?.archive).toMatchObject({
      error: "workflow_failed",
      status: "failed",
    });
    expect(await cardRuns(t, cardId)).toHaveLength(2);
  });

  test("a failed run of a link that already has a copy queues no archive run", async () => {
    const t = newBackend();
    const cardId = await insertCard(t, {
      pageArchive: archiveOf("k0"),
      // Its article is current too, so nothing is left to run.
      article: { extractedAt: NOW, status: "none" },
      processingStatus: {
        ...IDLE_STAGES,
        archive: { status: "completed" },
        metadata: { status: "in_progress" },
      },
    });
    const queued = await t.run((ctx) => queueCardProcessing(ctx, cardId));
    await t.mutation(internal.workflowDispatch.claim, {});

    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: queued?.instanceId as string,
      status: "errored",
    });

    expect(await cardRuns(t, cardId)).toHaveLength(1);
  });

  test("Refresh details starts the archive over; other resets keep it", async () => {
    const t = newBackend();
    const done = {
      archive: { completedAt: NOW, status: "completed" as const },
    };
    const refreshed = await insertCard(t, { processingStatus: done });
    const edited = await insertCard(t, { processingStatus: done });

    await t.run(async (ctx) => {
      await initializeCardProcessingState(ctx, refreshed, { refresh: true });
      await initializeCardProcessingState(ctx, edited);
    });

    expect((await card(t, refreshed)).processingStatus?.archive).toEqual({
      status: "pending",
    });
    expect((await card(t, edited)).processingStatus?.archive).toEqual({
      completedAt: NOW,
      status: "completed",
    });
  });
});

describe("createPageSnapshotUploadForUser", () => {
  const signUp = async () => {
    vi.stubEnv("FILES_BASE", "https://files.test");
    vi.stubEnv("FILES_SIGNING_SECRET", "secret");
    const t = newBackend();
    await seedWorkosOwner(t, OWNER);
    const mint = (bytes: number) =>
      t.mutation(
        internal.publicApiPageSnapshots.createPageSnapshotUploadForUser,
        { bytes, userId: OWNER }
      );
    return { mint, t };
  };

  test("signs a PUT of exactly that size under the owner's pending snapshots, claimed first", async () => {
    const { mint, t } = await signUp();

    const upload = await mint(4096);

    expect(upload).toMatchObject({
      maxFileSize: 20 * 1024 * 1024,
      method: "PUT",
    });
    expect(
      upload.fileKey.startsWith(
        `${buildR2UserPrefix(OWNER)}/${PENDING_UPLOAD_CARD_ID}/page-snapshot/`
      )
    ).toBe(true);
    const signed = new URL(upload.uploadUrl);
    expect(signed.searchParams.get("sz")).toBe("4096");
    expect(signed.searchParams.get("ct")).toBe("application/gzip");
    const owners = await t.run((ctx) =>
      ctx.db
        .query("accountStorageObjects")
        .withIndex("by_key", (q) => q.eq("key", upload.fileKey))
        .collect()
    );
    expect(owners.map((row) => row.userId)).toEqual([OWNER]);
    // The key it mints is one a save accepts.
    const { cardId } = await create(t, {
      content: LINK,
      pageSnapshotKey: upload.fileKey,
    });
    expect((await card(t, cardId)).pendingPageSnapshotKey).toBe(upload.fileKey);
  });

  test("refuses more than 20 MiB", async () => {
    const { mint } = await signUp();
    await expect(mint(20 * 1024 * 1024 + 1)).rejects.toThrow(
      "PAGE_SNAPSHOT_TOO_LARGE"
    );
  });

  test("allows 60 a minute", async () => {
    const { mint } = await signUp();
    for (let index = 0; index < 60; index += 1) {
      await mint(100);
    }
    await expect(mint(100)).rejects.toThrow("RATE_LIMITED");
  });
});

describe("pageSnapshotKey through the public API", () => {
  test("POST /v1/cards and a bulk create keep the caller's snapshot", async () => {
    const t = newBackend();
    await seedWorkosOwner(t, OWNER);
    const single = snapshotKey(OWNER, "single");
    const bulk = snapshotKey(OWNER, "bulk");
    await registerKey(t, OWNER, single);
    await registerKey(t, OWNER, bulk);

    const saved = await t.mutation(
      internal.publicApi.cardsForUser.quickSaveForUser,
      { pageSnapshotKey: single, url: LINK, userId: OWNER }
    );
    const result = await t.mutation(
      internal.publicApi.executeBulkCardsForUser,
      {
        items: [{ pageSnapshotKey: bulk, url: "https://example.com/other" }],
        operation: "create",
        userId: OWNER,
      }
    );

    expect((await card(t, saved.cardId)).pendingPageSnapshotKey).toBe(single);
    const bulkCard = (result.results[0] as { cardId: Id<"cards"> }).cardId;
    expect((await card(t, bulkCard)).pendingPageSnapshotKey).toBe(bulk);
  });
});
