/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const api = (internal as any)["migration/backfillVisualStyles"];

const setup = () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workflowTest.register(t);
  workosTest.register(t);
  const insert = (seed: Pick<Doc<"cards">, "type"> & Partial<Doc<"cards">>) =>
    t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        content: "",
        createdAt: 1,
        updatedAt: 1,
        ...seed,
      })
    );
  const scheduled = async () =>
    (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(50)))
      .map((job) => ({
        args: job.args[0] as Record<string, unknown>,
        delayMs: job.scheduledTime - Date.now(),
      }))
      .sort((a, b) => a.delayMs - b.delayMs);
  return { insert, scheduled, t };
};

describe("backfillVisualStyles", () => {
  test("a dry run counts images and video thumbnails, and queues nothing", async () => {
    const { insert, scheduled, t } = setup();
    await insert({ type: "image", fileKey: "k1", thumbnailKey: "t1" });
    await insert({ type: "video", thumbnailKey: "t2" });
    await insert({ type: "video" });
    await insert({ type: "image", fileKey: "k3", isDeleted: true });
    await insert({ type: "text", content: "hi" });

    const result = await t.mutation(api.backfillVisualStyles, {});
    expect(result.totals).toMatchObject({ examined: 5, candidates: 2 });
    expect(await scheduled()).toEqual([]);
  });

  test("a real run queues jobs of 16, 3.2 seconds apart", async () => {
    const { insert, scheduled, t } = setup();
    for (let index = 0; index < 20; index += 1) {
      await insert({ type: "image", fileKey: `k${index}` });
    }
    await t.mutation(api.backfillVisualStyles, { dryRun: false });
    const jobs = await scheduled();
    expect(jobs.map((job) => job.delayMs)).toEqual([0, 3200]);
    expect(jobs.map((job) => (job.args.cardIds as unknown[]).length)).toEqual([
      16, 4,
    ]);
  });
});

describe("applyVisualStyles", () => {
  test("writes, then reports no change on a repeat", async () => {
    const { insert, t } = setup();
    const cardId = await insert({ type: "image", thumbnailKey: "t1" });
    const args = { cardId, expectedSourceKey: "t1", styles: ["flat", "3d"] };
    expect(await t.mutation(api.applyVisualStyles, args)).toBe("changed");
    expect(await t.mutation(api.applyVisualStyles, args)).toBe("unchanged");
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.visualStyles).toEqual(["flat", "3d"]);
  });

  test("no styles clears old ones", async () => {
    const { insert, t } = setup();
    const cardId = await insert({
      type: "image",
      thumbnailKey: "t1",
      visualStyles: ["vintage"],
    });
    expect(
      await t.mutation(api.applyVisualStyles, {
        cardId,
        expectedSourceKey: "t1",
        styles: [],
      })
    ).toBe("changed");
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.visualStyles).toBeUndefined();
  });

  test.each([
    ["the thumbnail changed", { expectedSourceKey: "t0" }],
    ["a style is unknown", { styles: ["grunge"] }],
  ])("refuses when %s", async (_name, overrides) => {
    const { insert, t } = setup();
    const cardId = await insert({
      type: "image",
      thumbnailKey: "t1",
      visualStyles: ["vintage"],
    });
    expect(
      await t.mutation(api.applyVisualStyles, {
        cardId,
        expectedSourceKey: "t1",
        styles: ["flat"],
        ...overrides,
      })
    ).toBe("stale");
    const card = await t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.visualStyles).toEqual(["vintage"]);
  });
});
