import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import {
  markTagSummaryDirty,
  TAG_SUMMARY_DEBOUNCE_MS,
  tagSummaryRetryDelayMs,
} from "../tag/tagSummary";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const scheduledJobs = async (t: ReturnType<typeof convexTest>) =>
  (
    (await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    )) as Array<{ name: string; scheduledTime: number }>
  ).map((job) => ({
    name: job.name.split("/").pop() ?? job.name,
    scheduledTime: job.scheduledTime,
  }));

const refreshes = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("tagSummaryRefreshes").collect());

describe("tag summary retry policy", () => {
  test("backs off with doubling delays, then gives up", () => {
    // A recompute whose fold keeps failing reschedules itself on these delays
    // instead of dying; after the cap it reports and re-arms the refresh.
    expect(tagSummaryRetryDelayMs(0)).toBe(5000);
    expect(tagSummaryRetryDelayMs(1)).toBe(10_000);
    expect(tagSummaryRetryDelayMs(2)).toBe(20_000);
    expect(tagSummaryRetryDelayMs(3)).toBe(40_000);
    expect(tagSummaryRetryDelayMs(4)).toBe(80_000);
    expect(tagSummaryRetryDelayMs(5)).toBe(120_000);
    expect(tagSummaryRetryDelayMs(7)).toBe(120_000);
    expect(tagSummaryRetryDelayMs(8)).toBeNull();
    expect(tagSummaryRetryDelayMs(20)).toBeNull();
  });
});

describe("recomputeTagSummary", () => {
  test("a fresh recompute claims and clears the pending refresh", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => markTagSummaryDirty(ctx, "user-1", 0));
    expect(await refreshes(t)).toHaveLength(1);

    await t.action(internal.tag.tagSummary.recomputeTagSummary, {
      userId: "user-1",
    });

    expect(await refreshes(t)).toHaveLength(0);
    const summaries = await t.run((ctx) =>
      ctx.db.query("userTagSummaries").collect()
    );
    expect(summaries).toHaveLength(1);
  });

  test("a retry carrying its claim does not consume another refresh", async () => {
    // Regression for the stranded refresh: a failed first attempt consumes the
    // pending row, so the retry must reuse the original claimedAt instead of
    // claiming (and deleting) whatever refresh arrived since.
    const t = convexTest(schema, modules);
    await t.run((ctx) => markTagSummaryDirty(ctx, "user-1", 0));
    const NOW = Date.now();

    await t.action(internal.tag.tagSummary.recomputeTagSummary, {
      userId: "user-1",
      claimedAt: NOW,
      attempt: 1,
    });

    expect(await refreshes(t)).toHaveLength(1);
    const summaries = await t.run((ctx) =>
      ctx.db.query("userTagSummaries").collect()
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.computedAt).toBe(NOW);
  });

  test("rearmTagSummaryRefresh re-marks the summary dirty and reschedules", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.tag.tagSummary.rearmTagSummaryRefresh, {
      userId: "user-1",
    });

    expect(await refreshes(t)).toHaveLength(1);
    const recomputes = (await scheduledJobs(t)).filter((job) =>
      job.name.includes("recomputeTagSummary")
    );
    expect(recomputes).toHaveLength(1);
    expect(recomputes[0]?.scheduledTime).toBe(
      Date.now() + TAG_SUMMARY_DEBOUNCE_MS
    );
  });
});
