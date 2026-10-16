/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  patchCardWithSearchSync,
  syncCardSearchDocumentHandler,
} from "./card/searchDocumentHelpers";
import schema from "./schema";
import { TAG_OPERATION_STALL_MS } from "./shared/tags";
import {
  TAG_OPERATION_BATCH_SIZE,
  TAG_OPERATION_MAX_SYNC_WAITS,
  TAG_OPERATION_PASS_DELAY_MS,
} from "./tag/tagOperations";
import { markTagSummaryDirty, TAG_SUMMARY_PAGE_ROWS } from "./tag/tagSummary";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Partial<Omit<Doc<"cards">, "_id" | "_creationTime" | "userId">>;

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, "owner");
  const strangerWorkosId = await seedWorkosOwner(t, "stranger");
  const identity = (subject: string, externalId: string) =>
    t.withIdentity({
      issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
      subject,
      sid: `session_${externalId}`,
      email_verified: true,
      external_id: externalId,
    });
  const owner = identity(workosUserId, "owner");
  const stranger = identity(strangerWorkosId, "stranger");

  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);

  const insert = async (seed: CardSeed, userId = "owner") => {
    const id = await t.run(async (ctx) => {
      const cardId = await ctx.db.insert("cards", {
        userId,
        type: "text",
        content: "card",
        createdAt: 1000,
        updatedAt: 1000,
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, cardId);
      return cardId;
    });
    return id;
  };

  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId));

  const start = (
    kind: "rename" | "merge" | "delete",
    from: string,
    to?: string,
    as = owner
  ) => as.mutation(api.tags.startTagOperation, { kind, from, to });

  const summary = () => owner.query(api.tags.listTagSummary, {});

  return { t, owner, stranger, insert, card, start, summary, runScheduled };
};

describe("library-wide tag operations", () => {
  test("rename collapses case variants in user and AI tags, in Trash and Archive too", async () => {
    const { insert, card, start, runScheduled } = await setup();
    const active = await insert({ tags: ["Design", "web"] });
    const trashed = await insert({
      tags: ["DESIGN"],
      isDeleted: true,
      deletedAt: 1000,
    });
    const archived = await insert({
      aiTags: ["design", "ui"],
      isArchived: true,
    });
    const both = await insert({ tags: ["design"], aiTags: ["Design"] });
    const other = await insert({ tags: ["designer"] });
    await runScheduled();

    const operation = await start("rename", "design", "Design Systems");
    expect(operation).toMatchObject({
      kind: "rename",
      from: "design",
      to: "Design Systems",
      status: "running",
      total: 4,
    });
    await runScheduled();

    expect((await card(active))?.tags).toEqual(["Design Systems", "web"]);
    expect((await card(trashed))?.tags).toEqual(["Design Systems"]);
    expect((await card(archived))?.aiTags).toEqual(["Design Systems", "ui"]);
    expect((await card(archived))?.tags).toBeUndefined();
    expect((await card(both))?.tags).toEqual(["Design Systems"]);
    expect((await card(both))?.aiTags).toEqual(["Design Systems"]);
    expect((await card(other))?.tags).toEqual(["designer"]);
  });

  test("progress is recorded and the operation completes", async () => {
    const { owner, insert, start, runScheduled } = await setup();
    const count = TAG_OPERATION_BATCH_SIZE + 5;
    for (let index = 0; index < count; index += 1) {
      await insert({ tags: ["bulk"], createdAt: 1000 + index });
    }
    await insert({ tags: ["unrelated"] });
    await runScheduled();

    const operation = await start("delete", "BULK");
    await runScheduled();
    const done = await owner.query(api.tags.getTagOperation, {
      operationId: operation._id,
    });
    expect(done).toMatchObject({
      status: "completed",
      total: count,
      processed: count,
      changed: count,
    });
    expect(done?.completedAt).toBeTypeOf("number");
    expect(await owner.query(api.tags.getLatestTagOperation, {})).toMatchObject(
      { _id: operation._id, status: "completed" }
    );
  });

  test("merge dedupes and keeps the casing a card already uses for the target", async () => {
    const { insert, card, start, runScheduled } = await setup();
    const hasBoth = await insert({ tags: ["UX", "Research", "ux"] });
    const onlySource = await insert({ tags: ["ux"] });
    await insert({ tags: ["research"] });
    await runScheduled();

    await expect(start("merge", "ux", "UX")).rejects.toThrow(
      "Choose a different tag to merge into"
    );
    await start("merge", "ux", "research");
    await runScheduled();
    expect((await card(hasBoth))?.tags).toEqual(["Research"]);
    expect((await card(onlySource))?.tags).toEqual(["research"]);
  });

  test("merge keeps one target when the user and AI tags each have one", async () => {
    const { insert, card, start, runScheduled } = await setup();
    const id = await insert({ tags: ["draft", "keep"], aiTags: ["Final"] });
    const reverse = await insert({ tags: ["final"], aiTags: ["draft"] });
    await runScheduled();
    await start("merge", "draft", "final");
    await runScheduled();
    expect((await card(id))?.tags).toEqual(["keep"]);
    expect((await card(id))?.aiTags).toEqual(["Final"]);
    expect((await card(reverse))?.tags).toEqual(["final"]);
    expect((await card(reverse))?.aiTags).toBeUndefined();
  });

  test("a card the tag index had not caught up with is still changed", async () => {
    const { t, insert, card, start, runScheduled } = await setup();
    await insert({ tags: ["draft"] });
    await runScheduled();
    const late = await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content: "late",
        tags: ["draft"],
        createdAt: 1,
        updatedAt: 1,
      })
    );
    const operation = await start("rename", "draft", "final");
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
    expect((await card(late))?.tags).toEqual(["draft"]);
    await t.run((ctx) => syncCardSearchDocumentHandler(ctx, late));
    await runScheduled();
    expect((await card(late))?.tags).toEqual(["final"]);
    const done = await t.run((ctx) =>
      ctx.db.get("tagOperations", operation._id)
    );
    expect(done).toMatchObject({ status: "completed", changed: 2 });
  });

  test("waits for the user's tag syncs before completing", async () => {
    const { t, insert, card, start, runScheduled } = await setup();
    const first = await insert({ tags: ["draft"] });
    await runScheduled();
    const late = await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content: "late",
        tags: ["draft"],
        createdAt: 1,
        updatedAt: 1,
      })
    );
    const pendingSync = await t.run((ctx) =>
      ctx.db.insert("cardSearchTagSyncStates", {
        cardId: late,
        phase: "tags",
        generation: 1,
        offset: 0,
        pending: true,
        userId: "owner",
      })
    );
    const operation = await start("rename", "draft", "final");
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
    expect((await card(first))?.tags).toEqual(["final"]);
    vi.advanceTimersByTime(TAG_OPERATION_PASS_DELAY_MS + 1);
    await t.finishInProgressScheduledFunctions();
    expect(
      (await t.run((ctx) => ctx.db.get("tagOperations", operation._id)))?.status
    ).toBe("running");
    await t.run(async (ctx) => {
      await ctx.db.delete("cardSearchTagSyncStates", pendingSync);
      await syncCardSearchDocumentHandler(ctx, late);
    });
    await runScheduled();
    expect((await card(late))?.tags).toEqual(["final"]);
  });

  test("another user's pending tag syncs do not hold the change up", async () => {
    const { t, insert, start, runScheduled } = await setup();
    await insert({ tags: ["draft"] });
    const theirs = await insert({ tags: ["x"] }, "stranger");
    await runScheduled();
    await t.run((ctx) =>
      ctx.db.insert("cardSearchTagSyncStates", {
        cardId: theirs,
        phase: "tags",
        generation: 1,
        offset: 0,
        pending: true,
        userId: "stranger",
      })
    );
    const operation = await start("rename", "draft", "final");
    await runScheduled();
    const done = await t.run((ctx) =>
      ctx.db.get("tagOperations", operation._id)
    );
    expect(done).toMatchObject({ status: "completed" });
    expect(done?.syncWaits ?? 0).toBeLessThan(TAG_OPERATION_MAX_SYNC_WAITS);
  });

  test("a card restored from Trash behind the cursor is still changed", async () => {
    const { t, insert, card, start, runScheduled } = await setup();
    for (let index = 0; index < TAG_OPERATION_BATCH_SIZE + 5; index += 1) {
      await insert({ tags: ["draft"], createdAt: 2000 + index });
    }
    const trashed = await insert({
      tags: ["draft"],
      isDeleted: true,
      deletedAt: 1000,
      createdAt: 1000,
    });
    await runScheduled();
    await start("rename", "draft", "final");
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
    await t.run((ctx) =>
      patchCardWithSearchSync(ctx, trashed, {
        isDeleted: undefined,
        deletedAt: undefined,
      })
    );
    await runScheduled();
    expect((await card(trashed))?.tags).toEqual(["final"]);
  });

  test("delete removes the tag from user and AI tags", async () => {
    const { insert, card, start, runScheduled } = await setup();
    const id = await insert({ tags: ["Old", "keep"], aiTags: ["old"] });
    const onlyTag = await insert({ tags: ["old"] });
    await runScheduled();
    await start("delete", "old");
    await runScheduled();
    expect((await card(id))?.tags).toEqual(["keep"]);
    expect((await card(id))?.aiTags).toBeUndefined();
    expect((await card(onlyTag))?.tags).toBeUndefined();
  });

  test("renaming onto an existing tag suggests a merge; a case-only rename is allowed", async () => {
    const { insert, card, start, runScheduled } = await setup();
    const id = await insert({ tags: ["design", "Web"] });
    await runScheduled();
    await expect(start("rename", "design", "WEB")).rejects.toThrow(
      "TAG_EXISTS"
    );
    await start("rename", "design", "Design");
    await runScheduled();
    expect((await card(id))?.tags).toEqual(["Design", "Web"]);
  });

  test("changes a tag whose lowercase key is longer than its name", async () => {
    const { insert, card, start, runScheduled } = await setup();
    const name = "İ".repeat(64);
    const id = await insert({ tags: [name] });
    await runScheduled();
    await start("rename", name.toLowerCase(), "turkish");
    await runScheduled();
    expect((await card(id))?.tags).toEqual(["turkish"]);
  });

  test("refuses missing tags and bad names", async () => {
    const { insert, start, runScheduled } = await setup();
    await insert({ tags: ["real"] });
    await runScheduled();
    await expect(start("delete", "ghost")).rejects.toThrow("Tag not found");
    await expect(start("rename", "real", "   ")).rejects.toThrow(
      "Name the tag"
    );
    await expect(start("rename", "real", "x".repeat(65))).rejects.toThrow(
      "Tags can be at most 64 characters"
    );
  });

  test("one operation runs at a time per user; a stalled one is replaced", async () => {
    const { t, stranger, insert, start, runScheduled } = await setup();
    await insert({ tags: ["a", "b"] });
    await insert({ tags: ["mine"] }, "stranger");
    await runScheduled();

    const first = await start("rename", "a", "alpha");
    await expect(start("delete", "b")).rejects.toThrow(
      "Another tag change is still running"
    );
    await start("delete", "mine", undefined, stranger);

    await t.run((ctx) =>
      ctx.db.patch("tagOperations", first._id, {
        updatedAt: Date.now() - TAG_OPERATION_STALL_MS - 1,
      })
    );
    const second = await start("delete", "b");
    expect(second.status).toBe("running");
    const stalled = await t.run((ctx) =>
      ctx.db.get("tagOperations", first._id)
    );
    expect(stalled?.status).toBe("failed");
  });

  test("edits made while the operation runs are kept", async () => {
    const { t, insert, card, start, runScheduled } = await setup();
    const id = await insert({ tags: ["draft"], notes: "before" });
    await runScheduled();
    await start("rename", "draft", "final");
    await t.run((ctx) =>
      ctx.db.patch("cards", id, {
        notes: "after",
        tags: ["draft", "added-later"],
      })
    );
    await runScheduled();
    const updated = await card(id);
    expect(updated?.notes).toBe("after");
    expect(updated?.tags).toEqual(["final", "added-later"]);
  });

  test("stands down while the account is being deleted", async () => {
    const { t, insert, card, start, runScheduled } = await setup();
    const id = await insert({ tags: ["keep-me"] });
    await runScheduled();
    const operation = await start("delete", "keep-me");
    await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: "owner",
        startedAt: Date.now(),
      })
    );
    await t.mutation(internal.tag.tagOperations.runTagOperationBatch, {
      operationId: operation._id,
    });
    expect((await card(id))?.tags).toEqual(["keep-me"]);
    await t.run(async (ctx) => {
      await ctx.db.patch("tagOperations", operation._id, {
        status: "completed",
      });
    });
    await expect(start("delete", "keep-me")).rejects.toThrow();
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("tagSummaryRefreshes").collect()) {
        await ctx.db.delete("tagSummaryRefreshes", row._id);
      }
      await markTagSummaryDirty(ctx, "owner");
    });
    expect(
      await t.run((ctx) => ctx.db.query("tagSummaryRefreshes").collect())
    ).toEqual([]);
  });

  test("another user's operation reads as missing", async () => {
    const { owner, stranger, insert, start, runScheduled } = await setup();
    await insert({ tags: ["secret"] });
    await runScheduled();
    const operation = await start("delete", "secret");
    expect(
      await stranger.query(api.tags.getTagOperation, {
        operationId: operation._id,
      })
    ).toBeNull();
    expect(
      await owner.query(api.tags.getTagOperation, { operationId: "nope" })
    ).toBeNull();
  });
});

describe("tag summary snapshot", () => {
  test("counts tags on cards outside Trash and Archive, most-used first", async () => {
    const { owner, insert, summary, runScheduled } = await setup();
    expect(await summary()).toBeNull();
    await owner.mutation(api.tags.requestTagSummary, {});
    await runScheduled();
    expect(await summary()).toMatchObject({ items: [], isComplete: true });

    await insert({ tags: ["Design", "web"] });
    await insert({ tags: ["design"], aiTags: ["UI"] });
    await insert({ tags: ["design"], isDeleted: true, deletedAt: 1000 });
    await insert({ tags: ["archived-only"], isArchived: true });
    await runScheduled();

    expect((await summary())?.items).toEqual([
      { name: "design", count: 2 },
      { name: "ui", count: 1 },
      { name: "web", count: 1 },
    ]);
  });

  test("a burst of tag changes schedules one recompute", async () => {
    const { t, insert } = await setup();
    for (let index = 0; index < 5; index += 1) {
      await insert({ tags: [`tag-${index}`] });
    }
    await t.finishInProgressScheduledFunctions();
    for (let round = 0; round < 10; round += 1) {
      vi.advanceTimersByTime(1);
      await t.finishInProgressScheduledFunctions();
    }
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    const recomputes = scheduled.filter((job) =>
      job.name.includes("recomputeTagSummary")
    );
    expect(recomputes).toHaveLength(1);
    const refreshes = await t.run((ctx) =>
      ctx.db.query("tagSummaryRefreshes").collect()
    );
    expect(refreshes).toHaveLength(1);
  });

  test("asking for counts now moves a pending recompute sooner", async () => {
    const { t } = await setup();
    const dueAt = () =>
      t.run(async (ctx) => {
        const rows = await ctx.db.query("tagSummaryRefreshes").collect();
        return rows.map((row) => row.dueAt);
      });
    await t.run((ctx) => markTagSummaryDirty(ctx, "owner"));
    const [later] = await dueAt();
    await t.run((ctx) => markTagSummaryDirty(ctx, "owner", 0));
    const [sooner] = await dueAt();
    expect(sooner).toBeLessThan(later ?? 0);
    expect(sooner).toBeLessThanOrEqual(Date.now());
    await t.run((ctx) => markTagSummaryDirty(ctx, "owner"));
    expect(await dueAt()).toEqual([sooner]);
  });

  test("only changes that can move the counts schedule a recompute", async () => {
    const { t, insert, runScheduled } = await setup();
    const id = await insert({ tags: ["design"], notes: "before" });
    await runScheduled();
    const refreshes = () =>
      t.run((ctx) => ctx.db.query("tagSummaryRefreshes").collect());
    const patch = (value: Partial<Doc<"cards">>) =>
      t.run((ctx) =>
        patchCardWithSearchSync(ctx, id, { ...value, updatedAt: Date.now() })
      );
    const settle = async () => {
      for (let round = 0; round < 10; round += 1) {
        vi.advanceTimersByTime(1);
        await t.finishInProgressScheduledFunctions();
      }
    };
    expect(await refreshes()).toHaveLength(0);

    await patch({ isFavorited: true });
    await patch({ notes: "after" });
    await settle();
    expect(await refreshes()).toHaveLength(0);

    await patch({ tags: ["design", "web"] });
    await settle();
    expect(await refreshes()).toHaveLength(1);
    await runScheduled();
    await patch({ isArchived: true });
    await settle();
    expect(await refreshes()).toHaveLength(1);
  });

  test("pages through more rows than one page reads, including a tag split across pages", async () => {
    const { t, owner, summary } = await setup();
    const big = TAG_SUMMARY_PAGE_ROWS + 50;
    await t.run(async (ctx) => {
      for (let index = 0; index < big; index += 1) {
        const cardId = await ctx.db.insert("cards", {
          userId: "owner",
          type: "text",
          content: `card ${index}`,
          createdAt: 5000,
          updatedAt: 5000,
          tags: ["big"],
        });
        await ctx.db.insert("cardSearchTags", {
          cardId,
          userId: "owner",
          tag: "big",
          type: "text",
          cardCreatedAt: 5000,
          sourceUpdatedAt: 5000,
          syncGeneration: 1,
        });
        if (index < 3) {
          await ctx.db.insert("cardSearchTags", {
            cardId,
            userId: "owner",
            tag: "small",
            type: "text",
            cardCreatedAt: 5000,
            sourceUpdatedAt: 5000,
            syncGeneration: 1,
          });
        }
      }
      await ctx.db.insert("tagSummaryRefreshes", { userId: "owner", dueAt: 0 });
    });
    await t.action(internal.tag.tagSummary.recomputeTagSummary, {
      userId: "owner",
    });
    expect(await summary()).toMatchObject({
      items: [
        { name: "big", count: big },
        { name: "small", count: 3 },
      ],
      isComplete: true,
    });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("userTagSummaries").first();
      if (row) {
        await ctx.db.patch("userTagSummaries", row._id, { items: [] });
      }
    });
    await t.action(internal.tag.tagSummary.recomputeTagSummary, {
      userId: "owner",
    });
    expect((await owner.query(api.tags.listTagSummary, {}))?.items).toEqual([]);
  }, 30_000);
});

describe("overlapping recomputes", () => {
  test("a recompute that started earlier never replaces newer counts", async () => {
    const { t, summary } = await setup();
    const write = (claimedAt: number, name: string) =>
      t.mutation(internal.tag.tagSummary.writeTagSummary, {
        userId: "owner",
        items: [{ name, count: 1 }],
        isComplete: true,
        claimedAt,
      });
    await write(2000, "newer");
    await write(1000, "older");
    expect((await summary())?.items).toEqual([{ name: "newer", count: 1 }]);
    await write(3000, "newest");
    expect((await summary())?.items).toEqual([{ name: "newest", count: 1 }]);
  });
});

describe("tag listings with many small tags", () => {
  test("the snapshot counts every tag and the live listing stops at its bound, without failing", async () => {
    const { t, summary } = await setup();
    const distinct = 1200;
    await t.run(async (ctx) => {
      for (let index = 0; index < distinct; index += 1) {
        const tag = `topic-${String(index).padStart(4, "0")}`;
        const cardId = await ctx.db.insert("cards", {
          userId: "owner",
          type: "text",
          content: tag,
          createdAt: 1000 + index,
          updatedAt: 1000,
          tags: [tag],
        });
        await ctx.db.insert("cardSearchTags", {
          cardId,
          userId: "owner",
          tag,
          type: "text",
          cardCreatedAt: 1000 + index,
          sourceUpdatedAt: 1000,
          syncGeneration: 1,
        });
      }
      await ctx.db.insert("tagSummaryRefreshes", { userId: "owner", dueAt: 0 });
    });
    await t.action(internal.tag.tagSummary.recomputeTagSummary, {
      userId: "owner",
    });
    const snapshot = await summary();
    expect(snapshot?.items).toHaveLength(distinct);
    expect(snapshot?.isComplete).toBe(true);

    const live = await t.query(internal.publicApi.listTagsForUser, {
      userId: "owner",
    });
    expect(live.items).toHaveLength(500);
    expect(live.isComplete).toBe(false);
  }, 30_000);

  test("one snapshot page counts a page of rows, however many small tags they hold", async () => {
    // Counting tag by tag took a seek and a range query per tag: a page of
    // 500 small tags ran four to five seconds and timed out under load.
    const { t } = await setup();
    const distinct = 1200;
    await t.run(async (ctx) => {
      for (let index = 0; index < distinct; index += 1) {
        const tag = `idea-${String(index).padStart(4, "0")}`;
        const cardId = await ctx.db.insert("cards", {
          userId: "owner",
          type: "text",
          content: tag,
          createdAt: 1000,
          updatedAt: 1000,
          tags: [tag],
        });
        await ctx.db.insert("cardSearchTags", {
          cardId,
          userId: "owner",
          tag,
          type: "text",
          cardCreatedAt: 1000,
          sourceUpdatedAt: 1000,
          syncGeneration: 1,
        });
      }
    });

    const page = await t.query(internal.tag.tagSummary.countTagSummaryPage, {
      userId: "owner",
      cursor: null,
    });

    expect(page.counts).toHaveLength(distinct);
    expect(
      page.counts.every(({ count }: { count: number }) => count === 1)
    ).toBe(true);
    expect(page.continueCursor).toBeNull();
  }, 30_000);
});

describe("library tag filter", () => {
  test("lists a tag's cards in each view, combined with search, types and folders", async () => {
    const { t, owner, insert, runScheduled } = await setup();
    await insert({ content: "alpha note", tags: ["Design"], createdAt: 1 });
    await insert({
      content: "beta link",
      type: "link",
      aiTags: ["design"],
      createdAt: 2,
    });
    await insert({ content: "gamma", tags: ["other"], createdAt: 3 });
    await insert({
      content: "starred quote",
      type: "quote",
      tags: ["design"],
      isFavorited: true,
      createdAt: 3.5,
    });
    await insert({
      content: "archived design",
      tags: ["design"],
      isArchived: true,
      createdAt: 4,
    });
    await insert({
      content: "trashed design",
      tags: ["DESIGN"],
      isDeleted: true,
      deletedAt: 5,
      createdAt: 5,
    });
    await insert({
      content: "trashed starred link",
      type: "link",
      tags: ["design"],
      isFavorited: true,
      isDeleted: true,
      deletedAt: 6,
      createdAt: 6,
    });
    await runScheduled();

    const grid = async (args: Record<string, unknown>) =>
      (
        await owner.query(api.cards.searchCardsPaginated, {
          paginationOpts: { numItems: 50, cursor: null },
          ...args,
        })
      ).page.map((card: { content: string }) => card.content);

    expect(await grid({ tag: " Design " })).toEqual([
      "starred quote",
      "beta link",
      "alpha note",
    ]);
    expect(await grid({ tag: "design", sort: "oldest" })).toEqual([
      "alpha note",
      "beta link",
      "starred quote",
    ]);
    expect(await grid({ tag: "design", showArchivedOnly: true })).toEqual([
      "archived design",
    ]);
    expect(await grid({ tag: "design", showTrashOnly: true })).toEqual([
      "trashed starred link",
      "trashed design",
    ]);
    expect(await grid({ tag: "design", types: ["link"] })).toEqual([
      "beta link",
    ]);
    expect(await grid({ tag: "design", types: ["link", "text"] })).toEqual([
      "beta link",
      "alpha note",
    ]);
    expect(await grid({ tag: "design", favoritesOnly: true })).toEqual([
      "starred quote",
    ]);
    expect(
      await grid({ tag: "design", favoritesOnly: true, types: ["quote"] })
    ).toEqual(["starred quote"]);
    expect(
      await grid({ tag: "design", favoritesOnly: true, types: ["link"] })
    ).toEqual([]);
    expect(
      await grid({ tag: "design", showTrashOnly: true, types: ["text"] })
    ).toEqual(["trashed design"]);
    expect(
      await grid({ tag: "design", showTrashOnly: true, favoritesOnly: true })
    ).toEqual(["trashed starred link"]);
    expect(
      await grid({
        tag: "design",
        showTrashOnly: true,
        favoritesOnly: true,
        types: ["link"],
      })
    ).toEqual(["trashed starred link"]);
    expect(
      await grid({ tag: "design", showTrashOnly: true, types: ["quote"] })
    ).toEqual([]);
    expect(await grid({ tag: "design", searchQuery: "alpha" })).toEqual([
      "alpha note",
    ]);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("cards").collect();
      for (const row of rows) {
        if (row.content === "alpha note") {
          await ctx.db.patch("cards", row._id, { tags: ["other"] });
        }
        if (row.content === "beta link") {
          await ctx.db.patch("cards", row._id, { isArchived: true });
        }
      }
    });
    expect(await grid({ tag: "design" })).toEqual(["starred quote"]);
    expect(await grid({ tag: "design", showArchivedOnly: true })).toEqual([
      "archived design",
    ]);
    expect(await grid({ tag: "design", searchQuery: "trash" })).toEqual([]);
    expect(await grid({ tag: "missing" })).toEqual([]);
  }, 30_000);
});
