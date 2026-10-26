import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import {
  markTagSummaryDirty,
  TAG_SUMMARY_DEBOUNCE_MS,
  TAG_SUMMARY_RETRY_MAX_ATTEMPTS,
  tagSummaryRetryDelayMs,
} from "../tag/tagSummary";

// foldTagCountDeltas reads the deletion state first, so failing that read
// once makes the fold fail the way a real write conflict does.
const deletionState = vi.hoisted(() => ({ failNext: null as Error | null }));
vi.mock("../accountDeletion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../accountDeletion")>();
  return {
    ...actual,
    getAccountDeletionState: (
      ...args: Parameters<typeof actual.getAccountDeletionState>
    ) => {
      const failure = deletionState.failNext;
      if (failure) {
        deletionState.failNext = null;
        throw failure;
      }
      return actual.getAccountDeletionState(...args);
    },
  };
});

const modules = import.meta.glob("../**/*.ts");

const writeConflict = () =>
  new Error(
    'Documents read from or written to the "tagCountDeltas" table changed while this mutation was being run and on every subsequent retry.'
  );

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  deletionState.failNext = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});

const scheduledJobs = async (t: ReturnType<typeof convexTest>) =>
  (
    (await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    )) as Array<{ args: unknown[]; name: string; scheduledTime: number }>
  ).map((job) => ({
    args: job.args[0],
    name: job.name.split("/").pop() ?? job.name,
    scheduledTime: job.scheduledTime,
  }));

const recomputes = async (t: ReturnType<typeof convexTest>) =>
  (await scheduledJobs(t)).filter((job) =>
    job.name.includes("recomputeTagSummary")
  );

const summaries = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("userTagSummaries").collect());

const insertDeletedUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      deletedAt: Date.now(),
    })
  );

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

describe("recomputeTagSummary failures", () => {
  test("a write conflict retries later with the original claim", async () => {
    const t = convexTest(schema, modules);
    const NOW = Date.now();
    deletionState.failNext = writeConflict();

    await t.action(internal.tag.tagSummary.recomputeTagSummary, {
      userId: "user-1",
      claimedAt: NOW,
      attempt: 2,
    });

    expect(await summaries(t)).toHaveLength(0);
    expect(await recomputes(t)).toEqual([
      {
        args: { userId: "user-1", claimedAt: NOW, attempt: 3 },
        name: "tagSummary:recomputeTagSummary",
        scheduledTime: NOW + 20_000,
      },
    ]);
  });

  test("a conflict on the last attempt re-arms the refresh", async () => {
    const t = convexTest(schema, modules);
    const NOW = Date.now();
    deletionState.failNext = writeConflict();

    await t.action(internal.tag.tagSummary.recomputeTagSummary, {
      userId: "user-1",
      claimedAt: NOW,
      attempt: TAG_SUMMARY_RETRY_MAX_ATTEMPTS,
    });

    expect(await refreshes(t)).toHaveLength(1);
    expect(await recomputes(t)).toEqual([
      {
        args: { userId: "user-1" },
        name: "tagSummary:recomputeTagSummary",
        scheduledTime: NOW + TAG_SUMMARY_DEBOUNCE_MS,
      },
    ]);
  });

  test("any other error fails once instead of retrying forever", async () => {
    // Only write conflicts are transient. A deterministic error would fail
    // the same way on every retry, and re-arming it would loop for good.
    const t = convexTest(schema, modules);
    deletionState.failNext = new Error("deterministic failure");

    await expect(
      t.action(internal.tag.tagSummary.recomputeTagSummary, {
        userId: "user-1",
        claimedAt: Date.now(),
        attempt: TAG_SUMMARY_RETRY_MAX_ATTEMPTS,
      })
    ).rejects.toThrow("deterministic failure");

    expect(await recomputes(t)).toHaveLength(0);
    expect(await refreshes(t)).toHaveLength(0);
  });

  test("a retry after the account is deleted writes nothing back", async () => {
    // Deletion removes its accountDeletionStates row when it finishes, so a
    // retry that lands afterwards must check the user's deletedAt instead.
    const t = convexTest(schema, modules);
    await insertDeletedUser(t, "user-1");

    await t.action(internal.tag.tagSummary.recomputeTagSummary, {
      userId: "user-1",
      claimedAt: Date.now(),
      attempt: 1,
    });
    await t.mutation(internal.tag.tagSummary.rearmTagSummaryRefresh, {
      userId: "user-1",
    });

    expect(await summaries(t)).toHaveLength(0);
    expect(await refreshes(t)).toHaveLength(0);
    expect(await recomputes(t)).toHaveLength(0);
  });
});
