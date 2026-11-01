import rateLimiterTest from "@convex-dev/rate-limiter/test";
import counterTest from "@convex-dev/sharded-counter/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  type DevScenarioCardDef,
  insertCompletedCards,
} from "../card/defaultCards";
import { LINK_PASTE_RETENTION_MS } from "../card/pasteLinks";
import schema from "../schema";
import { FREE_TIER_LIMIT } from "../shared/constants";

const modules = import.meta.glob("../**/*.ts");

const NOW = Date.UTC(2026, 9, 20);
const FIRST_SAVED = Date.UTC(2026, 0, 1);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const links = (count: number, prefix = "new") =>
  Array.from(
    { length: count },
    (_, index) => `https://example.com/${prefix}/${index + 1}`
  );

const identityFor = (workosUserId: string, externalId: string) => ({
  issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
  subject: workosUserId,
  sid: `session_${externalId}`,
  email_verified: true,
  external_id: externalId,
});

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  apiKeysTest.register(t);
  counterTest.register(t, "apiKeys/shardedCounter");
  const owner = t.withIdentity(
    identityFor(await seedWorkosOwner(t, "owner"), "owner")
  );
  const seed = (cards: DevScenarioCardDef[]) =>
    t.run((ctx) =>
      insertCompletedCards(ctx, "owner", cards, { ignoreCardLimit: true })
    );
  const paste = (urls: string[]) =>
    owner.mutation(api.card.pasteLinks.startLinkPaste, { urls });
  const job = (jobId: Id<"linkPasteJobs">) =>
    t.run((ctx) => ctx.db.get("linkPasteJobs", jobId)) as Promise<
      Doc<"linkPasteJobs">
    >;
  const liveCards = () =>
    t.run((ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_user_deleted_saved", (q) =>
          q.eq("userId", "owner").eq("isDeleted", undefined)
        )
        .collect()
    );
  const pendingRuns = () =>
    t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (row) =>
          row.name.startsWith("card/pasteLinks:processLinkPaste") &&
          row.state.kind === "pending"
      )
    );
  const runAll = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, owner, seed, paste, job, liveCards, pendingRuns, runAll };
};

describe("pasting a list of links", () => {
  test("saves one link card per link, the first ten at once, the rest in the background", async () => {
    const { paste, job, liveCards, runAll, owner } = await setup();
    const urls = links(12);

    const { jobId } = await paste(urls);
    expect(await job(jobId)).toMatchObject({
      status: "running",
      total: 12,
      nextIndex: 10,
      created: 10,
    });
    expect(
      await owner.query(api.card.pasteLinks.getLinkPaste, { jobId })
    ).toMatchObject({ status: "running", total: 12, processed: 10 });

    await runAll();
    expect(
      await owner.query(api.card.pasteLinks.getLinkPaste, { jobId })
    ).toEqual({
      status: "done",
      total: 12,
      processed: 12,
      created: 12,
      resaved: 0,
      failed: 0,
      omittedOverLimit: 0,
      omittedRepeats: 0,
    });
    // Background completion lands when the jittered flush chain drains, so
    // it is no longer exactly NOW - it must still finish promptly.
    const finishedAt = (await job(jobId)).finishedAt ?? -1;
    expect(finishedAt).toBeGreaterThanOrEqual(NOW);
    expect(finishedAt).toBeLessThanOrEqual(NOW + 10_000);
    const cards = await liveCards();
    expect(cards.map((card) => card.url).sort()).toEqual([...urls].sort());
    expect(cards.every((card) => card.type === "link")).toBe(true);
  });

  test("counts repeats of one link once, by its URL key, and never tries unsafe lines", async () => {
    const { paste, job, runAll, liveCards } = await setup();
    const { jobId } = await paste([
      "https://www.example.com/post/",
      "http://example.com/post?utm_source=newsletter#top",
      "  https://example.com/b  ",
      "https://example.com/b/",
      "javascript:alert(1)",
      "",
    ]);
    await runAll();

    expect(await job(jobId)).toMatchObject({
      urls: ["https://www.example.com/post/", "https://example.com/b"],
      total: 2,
      omittedRepeats: 2,
      omittedUnsafe: 1,
      created: 2,
      failed: 1,
      status: "done",
    });
    expect(await liveCards()).toHaveLength(2);
  });

  test("keeps the first 100 links and says how many were left out", async () => {
    const { paste, job } = await setup();
    const urls = links(140);

    const { jobId } = await paste(urls);
    const stored = await job(jobId);
    expect(stored.total).toBe(100);
    expect(stored.urls).toEqual(urls.slice(0, 100));
    expect(stored.omittedOverLimit).toBe(40);
  });

  test("waits for the card creation limit, then carries on until every link is saved", async () => {
    const { t, paste, job, pendingRuns, liveCards, runAll } = await setup();
    const urls = links(45);
    const { jobId } = await paste(urls);

    let waiting: Awaited<ReturnType<typeof pendingRuns>>[number] | undefined;
    for (let run = 0; run < 10 && !waiting; run += 1) {
      const pending = await pendingRuns();
      expect(pending).toHaveLength(1);
      waiting = pending.find((row) => row.scheduledTime > Date.now());
      if (!waiting) {
        vi.runOnlyPendingTimers();
        await t.finishInProgressScheduledFunctions();
      }
    }
    expect(waiting).toBeDefined();
    const paused = await job(jobId);
    expect(paused.status).toBe("running");
    expect(paused.nextIndex).toBeLessThan(urls.length);
    expect(paused.created).toBe(paused.nextIndex);
    expect(paused.failed).toBe(0);
    // The bucket refills 30 a minute, so the wait is under a minute.
    expect(
      (waiting?.scheduledTime ?? Number.POSITIVE_INFINITY) - Date.now()
    ).toBeLessThanOrEqual(60_000);

    await runAll();
    expect(await job(jobId)).toMatchObject({
      status: "done",
      created: 45,
      failed: 0,
      nextIndex: 45,
    });
    expect(await liveCards()).toHaveLength(45);
  });

  test("moves links already in Teak to the top, counted as resaved, and brings archived ones back", async () => {
    const { seed, paste, job, runAll, liveCards } = await setup();
    const [kept, archived] = await seed([
      {
        type: "link",
        content: "https://example.com/kept",
        url: "https://example.com/kept",
        createdAt: FIRST_SAVED,
      },
      {
        type: "link",
        content: "https://example.com/archived",
        url: "https://example.com/archived",
        createdAt: FIRST_SAVED,
        isArchived: true,
      },
    ]);
    const { jobId } = await paste([
      "https://www.example.com/kept/",
      "https://example.com/archived",
      "https://example.com/new",
    ]);
    await runAll();

    expect(await job(jobId)).toMatchObject({
      status: "done",
      created: 1,
      resaved: 2,
    });
    const cards = await liveCards();
    expect(cards).toHaveLength(3);
    const byId = new Map(cards.map((card) => [card._id, card]));
    expect(byId.get(kept)?.savedAt).toBe(NOW);
    expect(byId.get(archived)?.isArchived).toBeUndefined();
  });

  test("stops at the free card limit, still moving links already in Teak", async () => {
    const { seed, paste, job, runAll, liveCards } = await setup();
    await seed([
      {
        type: "link",
        content: "https://example.com/known/1",
        url: "https://example.com/known/1",
        createdAt: FIRST_SAVED,
      },
      {
        type: "link",
        content: "https://example.com/known/2",
        url: "https://example.com/known/2",
        createdAt: FIRST_SAVED,
        isArchived: true,
      },
      ...Array.from({ length: FREE_TIER_LIMIT - 7 }, (_, index) => ({
        type: "text" as const,
        content: `Filler ${index}`,
        createdAt: FIRST_SAVED + index,
      })),
    ]);
    expect(await liveCards()).toHaveLength(FREE_TIER_LIMIT - 5);

    const { jobId } = await paste([
      "https://example.com/known/1",
      "https://example.com/known/2",
      ...links(10),
    ]);
    await runAll();

    expect(await job(jobId)).toMatchObject({
      status: "stopped_at_limit",
      resaved: 2,
      created: 5,
      nextIndex: 7,
      finishedAt: NOW,
    });
    expect(await liveCards()).toHaveLength(FREE_TIER_LIMIT);
  });

  test("counts a link that can never be saved as failed and moves on", async () => {
    const { t, job, runAll, liveCards } = await setup();
    const jobId = await t.run((ctx) =>
      ctx.db.insert("linkPasteJobs", {
        userId: "owner",
        urls: ["javascript:alert(1)", "https://example.com/fine"],
        total: 2,
        omittedOverLimit: 0,
        omittedRepeats: 0,
        omittedUnsafe: 0,
        nextIndex: 0,
        created: 0,
        resaved: 0,
        failed: 0,
        attempts: 0,
        status: "running",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.mutation(internal.card.pasteLinks.processLinkPaste, { jobId });

    expect(await job(jobId)).toMatchObject({
      status: "done",
      failed: 1,
      created: 1,
      nextIndex: 2,
    });
    await runAll();
    expect(await liveCards()).toHaveLength(1);
  });

  test("refuses a second paste while one is still saving, and allows it once that finishes", async () => {
    const { paste, runAll } = await setup();
    await paste(links(30, "first"));

    await expect(paste(links(2, "second"))).rejects.toMatchObject({
      data: expect.objectContaining({ code: "PASTE_ACTIVE" }),
    });

    await runAll();
    await expect(paste(links(2, "second"))).resolves.toMatchObject({
      jobId: expect.any(String),
    });
  });

  test("shows a job only to the account that pasted it", async () => {
    const { t, paste } = await setup();
    const { jobId } = await paste(links(2));
    const other = t.withIdentity(
      identityFor(await seedWorkosOwner(t, "other"), "other")
    );

    expect(
      await other.query(api.card.pasteLinks.getLinkPaste, { jobId })
    ).toBeNull();
    expect(await t.query(api.card.pasteLinks.getLinkPaste, { jobId })).toBe(
      null
    );
    await expect(
      t.mutation(api.card.pasteLinks.startLinkPaste, { urls: links(2) })
    ).rejects.toMatchObject({
      data: expect.objectContaining({ code: "UNAUTHENTICATED" }),
    });
  });
});

describe("sweeping finished paste jobs", () => {
  test("deletes jobs a week after they finished, and keeps newer and running ones", async () => {
    const { t } = await setup();
    const insert = (
      status: Doc<"linkPasteJobs">["status"],
      finishedAt?: number
    ) =>
      t.run((ctx) =>
        ctx.db.insert("linkPasteJobs", {
          userId: "owner",
          urls: [],
          total: 0,
          omittedOverLimit: 0,
          omittedRepeats: 0,
          omittedUnsafe: 0,
          nextIndex: 0,
          created: 0,
          resaved: 0,
          failed: 0,
          attempts: 0,
          status,
          createdAt: 0,
          updatedAt: 0,
          ...(finishedAt === undefined ? {} : { finishedAt }),
        })
      );
    const old = NOW - LINK_PASTE_RETENTION_MS - 1;
    await insert("done", old);
    await insert("stopped_at_limit", old);
    await insert("failed", old);
    const recent = await insert("done", NOW - LINK_PASTE_RETENTION_MS + 60_000);
    const running = await insert("running");

    expect(
      await t.mutation(internal.card.pasteLinks.sweepFinishedLinkPastes, {})
    ).toEqual({ deleted: 3 });
    const left = await t.run((ctx) => ctx.db.query("linkPasteJobs").collect());
    expect(left.map((row) => row._id).sort()).toEqual([recent, running].sort());
  });
});
