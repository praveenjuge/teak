/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Pick<Doc<"cards">, "type"> &
  Partial<Omit<Doc<"cards">, "_id" | "_creationTime" | "userId">>;

const setup = () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workflowTest.register(t);
  workosTest.register(t);
  const insert = (seed: CardSeed) =>
    t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        content: "",
        createdAt: 1,
        updatedAt: 1,
        ...seed,
      })
    );
  /** Jobs the backfill queued, in the order they are due. */
  const scheduled = async () =>
    (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(50)))
      .map((job) => ({
        name: job.name,
        args: job.args[0] as Record<string, unknown>,
        delayMs: job.scheduledTime - Date.now(),
      }))
      .sort((a, b) => a.delayMs - b.delayMs);
  const backfill = (args: {
    dryRun?: boolean;
    batchSize?: number;
    kinds?: ("image" | "gif" | "video")[];
    once?: boolean;
  }) =>
    t.mutation(
      internal.migration.backfillMediaColors.backfillMediaColors,
      args
    );
  return { backfill, insert, scheduled };
};

const seedLibrary = async (
  insert: (seed: CardSeed) => Promise<Id<"cards">>
) => ({
  image: await insert({
    type: "image",
    fileKey: "users/owner/cards/a/file/photo.jpg",
    colors: [{ hex: "#112233" }],
  }),
  gif: await insert({
    type: "video",
    fileKey: "users/owner/cards/b/file/loop.gif",
    fileMetadata: { fileName: "loop.gif", mimeType: "image/gif" },
  }),
  video: await insert({
    type: "video",
    fileKey: "users/owner/cards/c/file/clip.mp4",
    thumbnailKey: "users/owner/cards/c/thumbnail/old",
    fileMetadata: { fileName: "clip.mp4", mimeType: "video/mp4" },
  }),
  coloredVideo: await insert({
    type: "video",
    fileKey: "users/owner/cards/d/file/done.mp4",
    fileMetadata: { fileName: "done.mp4", mimeType: "video/mp4" },
    colors: [{ hex: "#FF8800" }],
  }),
  processingVideo: await insert({
    type: "video",
    fileKey: "users/owner/cards/e/file/new.mp4",
    fileMetadata: { fileName: "new.mp4", mimeType: "video/mp4" },
    processingStatus: { renderables: { status: "in_progress" } },
  }),
  trashedVideo: await insert({
    type: "video",
    fileKey: "users/owner/cards/f/file/old.mp4",
    fileMetadata: { fileName: "old.mp4", mimeType: "video/mp4" },
    isDeleted: true,
    deletedAt: 1,
  }),
  text: await insert({ type: "text", content: "a note" }),
});

const IMAGE_JOB = "workflows/steps/renderables/analyzeImage:analyzeImage";
const GIF_JOB =
  "workflows/steps/renderables/extractAnimationPalette:extractAnimationPalette";
const VIDEO_JOB =
  "workflows/steps/renderables/generateVideoThumbnail:generateVideoThumbnail";

describe("backfillMediaColors", () => {
  test("a dry run counts the cards and queues no colors jobs", async () => {
    const { backfill, insert, scheduled } = setup();
    await seedLibrary(insert);

    const result = await backfill({ batchSize: 10, once: true });

    expect(result.totals).toEqual({
      examined: 7,
      image: 1,
      gif: 1,
      video: 1,
      skippedInProgress: 1,
      skippedTrashed: 1,
      skippedDeletingAccounts: 0,
    });
    expect(await scheduled()).toEqual([]);
  });

  test("a real run queues one spaced job per card that needs colors", async () => {
    const { backfill, insert, scheduled } = setup();
    const cards = await seedLibrary(insert);

    await backfill({ dryRun: false, batchSize: 10, once: true });

    // Every image is recolored; the colored, still-processing and trashed
    // videos are left alone; the video renders again over its existing thumbnail.
    expect(await scheduled()).toEqual([
      { name: IMAGE_JOB, args: { cardId: cards.image }, delayMs: 0 },
      { name: GIF_JOB, args: { cardId: cards.gif }, delayMs: 200 },
      {
        name: VIDEO_JOB,
        args: { cardId: cards.video, rerender: true },
        delayMs: 2200,
      },
    ]);
  });

  test("the next batch waits until this batch's last job is due", async () => {
    const { backfill, insert, scheduled } = setup();
    const cards = await seedLibrary(insert);

    const first = await backfill({ dryRun: false, batchSize: 2 });

    expect(first.continuationScheduled).toBe(true);
    expect(await scheduled()).toEqual([
      { name: IMAGE_JOB, args: { cardId: cards.image }, delayMs: 0 },
      { name: GIF_JOB, args: { cardId: cards.gif }, delayMs: 200 },
      {
        name: "migration/backfillMediaColors:backfillMediaColors",
        args: expect.objectContaining({
          cursor: first.continueCursor,
          dryRun: false,
          totals: expect.objectContaining({ examined: 2, image: 1, gif: 1 }),
        }),
        delayMs: 2200,
      },
    ]);
  });

  test("kinds limits the run to those cards", async () => {
    const { backfill, insert, scheduled } = setup();
    const cards = await seedLibrary(insert);

    const result = await backfill({
      dryRun: false,
      batchSize: 10,
      kinds: ["video"],
      once: true,
    });

    expect(result.totals).toMatchObject({ image: 0, gif: 0, video: 1 });
    expect(await scheduled()).toEqual([
      {
        name: VIDEO_JOB,
        args: { cardId: cards.video, rerender: true },
        delayMs: 0,
      },
    ]);
  });
});
