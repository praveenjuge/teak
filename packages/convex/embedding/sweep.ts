import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { classifyEmbeddingRow } from "./state";

const PAGE_SIZE = 100;
// One run reads at most this many pages, well inside an action's time
// limit; a longer ledger carries on in the next run from the saved cursor.
const PAGES_PER_RUN = 200;
const STALE_TOMBSTONE_MS = 24 * 60 * 60 * 1000;
const SAMPLE_SIZE = 10;
const CURSOR_NAME = "vectorLedger";

const countsValidator = v.object({
  rows: v.number(),
  staleTombstones: v.number(),
  cardMissing: v.number(),
  failedEmbeds: v.number(),
  lostJobs: v.number(),
});

type Counts = typeof countsValidator.type;

// An `embedDue` job that died, either before its claim (its due time is long
// past) or after it (its lease ran out), leaves a row nothing will pick up.
const isStranded = (row: Doc<"cardEmbeddings">, now: number) =>
  row.dueAt !== undefined &&
  !(row.leaseUntil !== undefined && row.leaseUntil > now) &&
  (row.leaseUntil !== undefined ||
    classifyEmbeddingRow(row, now) === "lost_job");

export const sweepPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    now: v.number(),
  },
  returns: v.object({
    counts: countsValidator,
    samples: v.array(v.id("cards")),
    lostJobs: v.array(v.id("cards")),
    staleTombstones: v.array(v.id("cards")),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor, now }) => {
    const page = await ctx.db
      .query("cardEmbeddings")
      .paginate({ cursor, numItems: PAGE_SIZE });
    const counts: Counts = {
      rows: 0,
      staleTombstones: 0,
      cardMissing: 0,
      failedEmbeds: 0,
      lostJobs: 0,
    };
    const samples: Id<"cards">[] = [];
    const lostJobs: Id<"cards">[] = [];
    const staleTombstones: Id<"cards">[] = [];
    for (const row of page.page) {
      counts.rows += 1;
      const state = classifyEmbeddingRow(row, now);
      let problem = true;
      if (row.pendingVectorDeleteAt !== undefined) {
        problem = row.pendingVectorDeleteAt < now - STALE_TOMBSTONE_MS;
        if (problem) {
          counts.staleTombstones += 1;
          staleTombstones.push(row.cardId);
        }
      } else if (!(await ctx.db.get("cards", row.cardId))) {
        counts.cardMissing += 1;
      } else if (isStranded(row, now)) {
        counts.lostJobs += 1;
        lostJobs.push(row.cardId);
      } else if (state === "lost_job") {
        counts.lostJobs += 1;
      } else if (state === "failed") {
        counts.failedEmbeds += 1;
      } else {
        problem = false;
      }
      if (problem && samples.length < SAMPLE_SIZE) {
        samples.push(row.cardId);
      }
    }
    return {
      counts,
      samples,
      lostJobs,
      staleTombstones,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const readCursor = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) =>
    (
      await ctx.db
        .query("sweepCursors")
        .withIndex("by_name", (q) => q.eq("name", CURSOR_NAME))
        .unique()
    )?.cursor ?? null,
});

/**
 * Moves the saved cursor from `previous` to `next`. False when another run
 * moved it first, so two runs never sweep the same pages.
 */
export const saveCursor = internalMutation({
  args: {
    previous: v.union(v.string(), v.null()),
    next: v.union(v.string(), v.null()),
  },
  returns: v.boolean(),
  handler: async (ctx, { previous, next }) => {
    const row = await ctx.db
      .query("sweepCursors")
      .withIndex("by_name", (q) => q.eq("name", CURSOR_NAME))
      .unique();
    if ((row?.cursor ?? null) !== previous) {
      return false;
    }
    if (row) {
      await ctx.db.patch("sweepCursors", row._id, {
        cursor: next,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("sweepCursors", {
        cursor: next,
        name: CURSOR_NAME,
        updatedAt: Date.now(),
      });
    }
    return true;
  },
});

export const sweepVectorLedger = internalAction({
  args: { pagesPerRun: v.optional(v.number()) },
  returns: v.object({ ...countsValidator.fields, complete: v.boolean() }),
  handler: async (ctx, { pagesPerRun }) => {
    const now = Date.now();
    const totals: Counts = {
      rows: 0,
      staleTombstones: 0,
      cardMissing: 0,
      failedEmbeds: 0,
      lostJobs: 0,
    };
    const samples: string[] = [];
    const start: string | null = await ctx.runQuery(
      internal.embedding.sweep.readCursor,
      {}
    );
    let cursor = start;
    let complete = false;
    const maxPages = Math.min(pagesPerRun ?? PAGES_PER_RUN, PAGES_PER_RUN);
    for (let pages = 0; pages < maxPages; pages += 1) {
      const page: {
        counts: Counts;
        samples: string[];
        lostJobs: Id<"cards">[];
        staleTombstones: Id<"cards">[];
        continueCursor: string;
        isDone: boolean;
      } = await ctx.runQuery(internal.embedding.sweep.sweepPage, {
        cursor,
        now,
      });
      for (const key of Object.keys(totals) as (keyof Counts)[]) {
        totals[key] += page.counts[key];
      }
      samples.push(...page.samples.slice(0, SAMPLE_SIZE - samples.length));
      if (page.lostJobs.length > 0) {
        await ctx.scheduler.runAfter(0, internal.embedding.embedCard.embedDue, {
          cardIds: page.lostJobs,
        });
      }
      if (page.staleTombstones.length > 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.embedding.embedCard.deleteVectors,
          { attempt: 1, cardIds: page.staleTombstones }
        );
      }
      if (page.isDone) {
        complete = true;
        break;
      }
      cursor = page.continueCursor;
    }
    const saved: boolean = await ctx.runMutation(
      internal.embedding.sweep.saveCursor,
      { next: complete ? null : cursor, previous: start }
    );
    if (saved && !complete) {
      await ctx.scheduler.runAfter(
        0,
        internal.embedding.sweep.sweepVectorLedger,
        pagesPerRun === undefined ? {} : { pagesPerRun }
      );
    }
    const problems = sumProblems(totals);
    let message = "vectors.ledger_clean";
    if (problems > 0) {
      message = "vectors.ledger_problems_detected";
    } else if (!complete) {
      message = "vectors.ledger_sweep_incomplete";
    }
    console.log("[embedding/sweep]", message, { ...totals, complete, samples });
    return { ...totals, complete };
  },
});

const sumProblems = (counts: Counts) =>
  counts.staleTombstones +
  counts.cardMissing +
  counts.failedEmbeds +
  counts.lostJobs;
