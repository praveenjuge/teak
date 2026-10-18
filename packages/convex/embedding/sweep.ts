import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { classifyEmbeddingRow } from "./state";

const PAGE_SIZE = 100;
const MAX_PAGES = 5000;
const STALE_TOMBSTONE_MS = 24 * 60 * 60 * 1000;
const SAMPLE_SIZE = 10;

const countsValidator = v.object({
  rows: v.number(),
  staleTombstones: v.number(),
  cardMissing: v.number(),
  failedEmbeds: v.number(),
  lostJobs: v.number(),
});

type Counts = typeof countsValidator.type;

export const sweepPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    now: v.number(),
  },
  returns: v.object({
    counts: countsValidator,
    samples: v.array(v.id("cards")),
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
    for (const row of page.page) {
      counts.rows += 1;
      const state = classifyEmbeddingRow(row, now);
      let problem = true;
      if (row.pendingVectorDeleteAt !== undefined) {
        problem = row.pendingVectorDeleteAt < now - STALE_TOMBSTONE_MS;
        counts.staleTombstones += problem ? 1 : 0;
      } else if (!(await ctx.db.get("cards", row.cardId))) {
        counts.cardMissing += 1;
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
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const sweepVectorLedger = internalAction({
  args: {},
  returns: v.object({ ...countsValidator.fields, complete: v.boolean() }),
  handler: async (ctx) => {
    const now = Date.now();
    const totals: Counts = {
      rows: 0,
      staleTombstones: 0,
      cardMissing: 0,
      failedEmbeds: 0,
      lostJobs: 0,
    };
    const samples: string[] = [];
    let cursor: string | null = null;
    let complete = false;
    for (let pages = 0; pages < MAX_PAGES; pages += 1) {
      const page: {
        counts: Counts;
        samples: string[];
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
      if (page.isDone) {
        complete = true;
        break;
      }
      cursor = page.continueCursor;
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
