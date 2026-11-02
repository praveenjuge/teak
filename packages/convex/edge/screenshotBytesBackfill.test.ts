import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const SIZES: Partial<Record<string, number>> = {
  "users/owner/cards/blank/screenshot/a.jpg": 6100,
  "users/owner/cards/rich/screenshot/b.jpg": 118_000,
};

// The Core Worker's head-object op: the size of a stored object, or
// exists: false.
const stubHeadObject = () => {
  const keys: string[] = [];
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "screenshot-bytes-test-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: unknown, init?: RequestInit) => {
      const { op, params } = JSON.parse(String(init?.body));
      expect(op).toBe("head-object");
      keys.push(params.key);
      const size = SIZES[params.key];
      return Response.json({
        ok: true,
        version: 1,
        requestId: "r",
        data: size === undefined ? { exists: false } : { exists: true, size },
      });
    })
  );
  return keys;
};

const setup = () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  let createdAt = 1000;
  const link = (key: string | undefined, extra: Record<string, unknown> = {}) =>
    t.run((ctx) => {
      createdAt += 1;
      return ctx.db.insert("cards", {
        content: "",
        createdAt,
        metadata: {
          linkPreview: {
            status: "success",
            ...(key
              ? {
                  screenshotHeight: 720,
                  screenshotStorageKey: key,
                  screenshotWidth: 1280,
                }
              : {}),
            ...extra,
          },
        },
        type: "link",
        updatedAt: createdAt,
        url: `https://example.com/${createdAt}`,
        userId: "owner",
      });
    });
  const preview = async (cardId: Id<"cards">) =>
    ((await t.run((ctx) => ctx.db.get("cards", cardId))) as Doc<"cards">)
      .metadata?.linkPreview;
  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, link, preview, runScheduled };
};

describe("backfillScreenshotBytes", () => {
  test("a dry run counts the screenshots to measure and changes nothing", async () => {
    const keys = stubHeadObject();
    const { t, link, preview, runScheduled } = setup();
    const blank = await link("users/owner/cards/blank/screenshot/a.jpg");
    await link("users/owner/cards/rich/screenshot/b.jpg", {
      screenshotBytes: 118_000,
    });
    await link(undefined);

    const result = await t.mutation(
      internal.migration.backfillScreenshotBytes.backfillScreenshotBytes,
      {}
    );
    await runScheduled();

    expect(result.dryRun).toBe(true);
    expect(result.totals).toEqual({
      alreadyMeasured: 1,
      examined: 3,
      noScreenshot: 1,
      queued: 1,
      skippedDeletingAccounts: 0,
    });
    expect(keys).toEqual([]);
    expect((await preview(blank))?.screenshotBytes).toBeUndefined();
  });

  test("a live run stores each screenshot's size, and the card's updatedAt stays", async () => {
    const keys = stubHeadObject();
    const { t, link, preview, runScheduled } = setup();
    const blank = await link("users/owner/cards/blank/screenshot/a.jpg");
    const rich = await link("users/owner/cards/rich/screenshot/b.jpg");
    const gone = await link("users/owner/cards/gone/screenshot/c.jpg");
    const before = await t.run((ctx) => ctx.db.get("cards", blank));

    await t.mutation(
      internal.migration.backfillScreenshotBytes.backfillScreenshotBytes,
      { dryRun: false }
    );
    await runScheduled();

    expect(keys.sort()).toEqual(
      [
        "users/owner/cards/blank/screenshot/a.jpg",
        "users/owner/cards/gone/screenshot/c.jpg",
        "users/owner/cards/rich/screenshot/b.jpg",
      ].sort()
    );
    expect((await preview(blank))?.screenshotBytes).toBe(6100);
    expect((await preview(rich))?.screenshotBytes).toBe(118_000);
    expect((await preview(gone))?.screenshotBytes).toBeUndefined();
    const after = await t.run((ctx) => ctx.db.get("cards", blank));
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  test("a screenshot replaced while it was measured keeps its own size", async () => {
    stubHeadObject();
    const { t, link, preview } = setup();
    const cardId = await link("users/owner/cards/blank/screenshot/a.jpg");
    await t.run(async (ctx) => {
      const card = await ctx.db.get("cards", cardId);
      await ctx.db.patch("cards", cardId, {
        metadata: {
          ...card?.metadata,
          linkPreview: {
            ...card?.metadata?.linkPreview,
            screenshotStorageKey: "users/owner/cards/blank/screenshot/new.jpg",
          },
        },
      });
    });

    const stored = await t.mutation(
      internal.migration.backfillScreenshotBytes.storeScreenshotBytes,
      {
        cardId,
        screenshotBytes: 6100,
        screenshotStorageKey: "users/owner/cards/blank/screenshot/a.jpg",
      }
    );

    expect(stored).toBe(false);
    expect((await preview(cardId))?.screenshotBytes).toBeUndefined();
  });
});
