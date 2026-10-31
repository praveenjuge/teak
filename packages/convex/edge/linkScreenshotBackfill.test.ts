import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const IN_WINDOW = Date.parse("2026-10-20T12:00:00Z");
const BEFORE = Date.parse("2026-10-01T12:00:00Z");
const ARCHIVE = "users/owner/cards/c/page-archive/r1-archive.html";
const OLD_SHOT = "users/owner/cards/c/screenshot/unstyled";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const stubCoreWorker = (
  answer: { data: unknown } | { error: string; status: number }
) => {
  const calls: { op: string; params: Record<string, unknown> }[] = [];
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "restyle-test-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: unknown, init?: RequestInit) => {
      const { op, params } = JSON.parse(String(init?.body));
      calls.push({ op, params });
      return "error" in answer
        ? Response.json(
            {
              ok: false,
              version: 1,
              requestId: "r",
              error: {
                code: answer.error,
                message: answer.error,
                retryable: false,
              },
            },
            { status: answer.status }
          )
        : Response.json({ ok: true, version: 1, requestId: "r", ...answer });
    })
  );
  return calls;
};

const link = (
  preview: Record<string, unknown>,
  fields: Partial<Doc<"cards">> = {}
): Omit<Doc<"cards">, "_id" | "_creationTime"> => ({
  userId: "owner",
  type: "link",
  content: "https://example.com",
  url: "https://example.com",
  createdAt: 1,
  updatedAt: 1,
  metadata: {
    linkPreview: {
      source: "test",
      status: "success",
      screenshotStorageKey: OLD_SHOT,
      screenshotUpdatedAt: IN_WINDOW,
      ...preview,
    },
  },
  pageArchive: {
    bytes: 10,
    capturedAt: IN_WINDOW,
    kind: "full",
    source: "server",
    sourceUrl: "https://example.com",
    storageKey: ARCHIVE,
  },
  ...fields,
});

const setup = () => {
  const t = convexTest(schema, modules);
  const insert = (card: ReturnType<typeof link>) =>
    t.run((ctx) => ctx.db.insert("cards", card));
  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId));
  const deletedKeys = () =>
    t.run(async (ctx) =>
      (await ctx.db.query("workflowDispatches").collect())
        .filter((row) => row.kind === "deleteObjects")
        .flatMap((row) => row.keys ?? [])
    );
  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, insert, card, deletedKeys, runScheduled };
};

const seed = (insert: ReturnType<typeof setup>["insert"]) =>
  Promise.all([
    insert(link({})),
    insert(
      link({ imageStorageKey: "users/owner/cards/c/link-preview-image/og" })
    ),
    insert(link({ screenshotUpdatedAt: BEFORE })),
    insert(link({}, { pageArchive: undefined })),
    insert(link({}, { isDeleted: true })),
    insert({ ...link({}), type: "text", metadata: undefined }),
  ]);

describe("backfillLinkScreenshots", () => {
  test("a dry run counts the cards and writes nothing", async () => {
    const calls = stubCoreWorker({ data: { height: 720, width: 1280 } });
    const { t, insert } = setup();
    await seed(insert);

    const result = await t.mutation(
      internal.migration.backfillLinkScreenshots.backfillLinkScreenshots,
      { batchSize: 50, once: true }
    );

    expect(result.dryRun).toBe(true);
    expect(result.batch).toEqual({
      examined: 6,
      notLink: 1,
      trashed: 1,
      noScreenshot: 0,
      outsideWindow: 1,
      noFullCopy: 1,
      skippedDeletingAccounts: 0,
      skippedHasPreviewImage: 0,
      queued: 2,
      queuedShown: 1,
    });
    expect(calls).toEqual([]);
  });

  test("onlyShown leaves cards whose grid shows their own preview image", async () => {
    stubCoreWorker({ data: { height: 720, width: 1280 } });
    const { t, insert } = setup();
    await seed(insert);

    const result = await t.mutation(
      internal.migration.backfillLinkScreenshots.backfillLinkScreenshots,
      { batchSize: 50, once: true, onlyShown: true }
    );

    expect(result.batch).toMatchObject({
      queued: 1,
      queuedShown: 1,
      skippedHasPreviewImage: 1,
    });
  });

  test("a real run renders the saved copy, swaps the screenshot and isn't picked again", async () => {
    const calls = stubCoreWorker({ data: { height: 720, width: 1280 } });
    const { t, insert, card, deletedKeys, runScheduled } = setup();
    const [shown] = await seed(insert);

    await t.mutation(
      internal.migration.backfillLinkScreenshots.backfillLinkScreenshots,
      { batchSize: 2, dryRun: false }
    );
    await runScheduled();

    const captures = calls.filter((call) => call.op === "capture-screenshot");
    expect(captures).toHaveLength(2);
    const restyled = new RegExp(
      `^users/[^/]+/cards/${shown}/screenshot/restyled$`
    );
    expect(captures[0]?.params).toEqual({
      archiveKey: ARCHIVE,
      destinationKey: expect.stringMatching(restyled),
    });
    const preview = (await card(shown))?.metadata?.linkPreview;
    expect(preview).toMatchObject({
      screenshotHeight: 720,
      screenshotStorageKey: captures[0]?.params.destinationKey,
      screenshotWidth: 1280,
    });
    expect(preview?.screenshotUpdatedAt).toBeGreaterThan(
      Date.parse("2026-10-31T10:00:00Z")
    );
    expect(await deletedKeys()).toContain(OLD_SHOT);

    const again = await t.mutation(
      internal.migration.backfillLinkScreenshots.backfillLinkScreenshots,
      { batchSize: 50, once: true }
    );
    expect(again.batch).toMatchObject({ queued: 0, outsideWindow: 3 });
  });

  test("a card re-captured meanwhile keeps its own screenshot", async () => {
    stubCoreWorker({ data: { height: 720, width: 1280 } });
    const { t, insert, card, deletedKeys } = setup();
    const cardId = await insert(link({}));
    const newer = "users/owner/cards/c/screenshot/newer";
    await t.run((ctx) =>
      ctx.db.patch("cards", cardId, {
        metadata: {
          linkPreview: {
            source: "test",
            status: "success",
            screenshotStorageKey: newer,
            screenshotUpdatedAt: IN_WINDOW,
          },
        },
      })
    );

    const swapped = await t.mutation(
      internal.migration.backfillLinkScreenshots.swapLinkScreenshot,
      {
        cardId,
        replaces: OLD_SHOT,
        screenshotHeight: 720,
        screenshotStorageKey: "users/owner/cards/c/screenshot/restyled",
        screenshotWidth: 1280,
      }
    );

    expect(swapped).toBe(false);
    expect(
      (await card(cardId))?.metadata?.linkPreview?.screenshotStorageKey
    ).toBe(newer);
    expect(await deletedKeys()).toEqual([
      "users/owner/cards/c/screenshot/restyled",
    ]);
  });

  test("a copy the renderer declines leaves the card as it was", async () => {
    stubCoreWorker({ error: "NOT_FOUND", status: 404 });
    const { t, insert, card } = setup();
    const cardId = await insert(link({}));

    const result = await t.action(
      internal.migration.backfillLinkScreenshots.retakeLinkScreenshot,
      { cardId }
    );

    expect(result).toBe("failed");
    expect(
      (await card(cardId))?.metadata?.linkPreview?.screenshotStorageKey
    ).toBe(OLD_SHOT);
  });
});
