import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// 14:30:05 on the camera's clock at +05:30, as the Worker reads it.
const CLOCK = Date.parse("2026-05-17T14:30:05Z");
const INSTANT = Date.parse("2026-05-17T09:00:05Z");

type Exif = NonNullable<NonNullable<Doc<"cards">["fileMetadata"]>["exif"]>;

const stubFilesWorker = (exifFor: (sourceKey: string) => Exif | "error") => {
  const keys: string[] = [];
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "exif-test-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: unknown, init?: RequestInit) => {
      const { op, params } = JSON.parse(String(init?.body));
      expect(op).toBe("analyze-image");
      keys.push(params.sourceKey);
      const exif = exifFor(params.sourceKey);
      if (exif === "error") {
        return Response.json(
          {
            ok: false,
            version: 1,
            requestId: "r",
            error: {
              code: "NOT_FOUND",
              message: "source_not_found",
              retryable: false,
            },
          },
          { status: 404 }
        );
      }
      return Response.json({
        ok: true,
        version: 1,
        requestId: "r",
        data: { exif, height: 480, palette: ["#c95128"], width: 640 },
      });
    })
  );
  return keys;
};

const setup = () => {
  const t = convexTest(schema, modules);
  const insert = (name: string, fields: Partial<Doc<"cards">> = {}) =>
    t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        type: "image",
        content: "",
        createdAt: 1000,
        updatedAt: 1000,
        fileKey: `users/owner/cards/c/file/${name}.jpg`,
        fileMetadata: {
          fileName: `${name}.jpg`,
          fileSize: 5000,
          mimeType: "image/jpeg",
          exif: { make: "Teak Camera Co", takenAt: INSTANT },
        },
        ...fields,
      })
    );
  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId));
  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const backfill = (args: { dryRun?: boolean } = {}) =>
    t.mutation(internal.migration.backfillExifClock.backfillExifClock, {
      batchSize: 2,
      ...args,
    });
  return { t, insert, card, runScheduled, backfill };
};

describe("backfillExifClock", () => {
  test("a dry run counts the photos to read and calls nothing", async () => {
    const keys = stubFilesWorker(() => "error");
    const { t, insert, runScheduled } = setup();
    await insert("offset");
    await insert("nooffset");
    await insert("done", {
      fileMetadata: {
        fileName: "done.jpg",
        fileSize: 1,
        mimeType: "image/jpeg",
        exif: { takenAt: INSTANT, takenAtClock: CLOCK },
      },
    });
    await insert("no file", { fileKey: undefined });
    await insert("no exif", {
      fileMetadata: { fileName: "x.jpg", fileSize: 1, mimeType: "image/jpeg" },
    });
    await insert("note", { type: "text", content: "note" });

    const result = await t.mutation(
      internal.migration.backfillExifClock.backfillExifClock,
      { batchSize: 50, once: true }
    );
    await runScheduled();

    expect(result.dryRun).toBe(true);
    expect(result.batch).toEqual({
      examined: 6,
      alreadyStored: 1,
      noSource: 1,
      queued: 2,
      skippedDeletingAccounts: 0,
    });
    expect(keys).toEqual([]);
  });

  test("totals across pages count only image cards that still need the clock", async () => {
    stubFilesWorker(() => "error");
    const { t, insert, runScheduled } = setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await insert("offset");
    await insert("nooffset");
    await insert("done", {
      fileMetadata: {
        fileName: "done.jpg",
        fileSize: 1,
        mimeType: "image/jpeg",
        exif: { takenAt: INSTANT, takenAtClock: CLOCK },
      },
    });
    await insert("no file", { fileKey: undefined });
    await insert("note", { type: "text", content: "note" });

    await t.mutation(internal.migration.backfillExifClock.backfillExifClock, {
      batchSize: 2,
    });
    await runScheduled();

    expect(log).toHaveBeenCalledWith("backfillExifClock finished", {
      dryRun: true,
      examined: 5,
      alreadyStored: 1,
      noSource: 1,
      queued: 2,
      skippedDeletingAccounts: 0,
    });
  });

  test("stores the camera's clock and offset next to the EXIF already there", async () => {
    const keys = stubFilesWorker((key) =>
      key.endsWith("offset.jpg") && !key.endsWith("nooffset.jpg")
        ? { takenAt: INSTANT, takenAtClock: CLOCK, takenAtOffset: 330 }
        : { takenAt: CLOCK, takenAtClock: CLOCK }
    );
    const { insert, card, runScheduled, backfill } = setup();
    const offset = await insert("offset");
    const nooffset = await insert("nooffset", {
      fileMetadata: {
        fileName: "nooffset.jpg",
        fileSize: 5000,
        mimeType: "image/jpeg",
        exif: { iso: 400, takenAt: CLOCK },
      },
    });
    const note = await insert("note", { type: "text", content: "note" });

    await backfill({ dryRun: false });
    await runScheduled();

    expect(keys.sort()).toEqual([
      "users/owner/cards/c/file/nooffset.jpg",
      "users/owner/cards/c/file/offset.jpg",
    ]);
    const withOffset = await card(offset);
    expect(withOffset?.fileMetadata).toEqual({
      fileName: "offset.jpg",
      fileSize: 5000,
      mimeType: "image/jpeg",
      exif: {
        make: "Teak Camera Co",
        takenAt: INSTANT,
        takenAtClock: CLOCK,
        takenAtOffset: 330,
      },
    });
    expect(withOffset?.updatedAt).toBe(1000);
    expect((await card(nooffset))?.fileMetadata?.exif).toEqual({
      iso: 400,
      takenAt: CLOCK,
      takenAtClock: CLOCK,
    });
    expect((await card(note))?.updatedAt).toBe(1000);
  });

  test("leaves a photo alone when the Worker can't read it or reads a different capture time", async () => {
    stubFilesWorker((key) =>
      key.endsWith("gone.jpg")
        ? "error"
        : { takenAt: INSTANT + 60_000, takenAtClock: CLOCK + 60_000 }
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { t, insert, card } = setup();
    const gone = await insert("gone");
    const replaced = await insert("replaced");

    for (const [cardId, outcome] of [
      [gone, "failed"],
      [replaced, "unreadable"],
    ] as const) {
      expect(
        await t.action(
          internal.migration.backfillExifClock.backfillExifClockCard,
          { cardId }
        )
      ).toBe(outcome);
      expect(await card(cardId)).toMatchObject({
        updatedAt: 1000,
        fileMetadata: { exif: { make: "Teak Camera Co", takenAt: INSTANT } },
      });
    }
    expect(warn).toHaveBeenCalledWith(
      "[backfillExifClock] Worker declined to read EXIF",
      { cardId: gone, code: "NOT_FOUND" }
    );
  });

  test("keeps what card processing wrote while the Worker was reading", async () => {
    stubFilesWorker(() => "error");
    const { t, insert, card } = setup();
    const cardId = await insert("reprocessed");
    const fresh = { takenAt: INSTANT, takenAtClock: CLOCK, takenAtOffset: 330 };
    await t.run((ctx) =>
      ctx.db.patch("cards", cardId, {
        fileMetadata: {
          fileName: "reprocessed.jpg",
          fileSize: 5000,
          mimeType: "image/jpeg",
          exif: fresh,
        },
      })
    );

    expect(
      await t.mutation(internal.migration.backfillExifClock.storeExifClock, {
        cardId,
        takenAt: INSTANT,
        takenAtClock: CLOCK + 1,
      })
    ).toBe(false);
    expect((await card(cardId))?.fileMetadata?.exif).toEqual(fresh);
  });

  test("skips accounts being deleted", async () => {
    const keys = stubFilesWorker(() => ({
      takenAt: INSTANT,
      takenAtClock: CLOCK,
    }));
    const { t, insert, card, runScheduled, backfill } = setup();
    const cardId = await insert("leaving");
    await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        startedAt: Date.now(),
        userId: "owner",
      })
    );

    const result = await backfill({ dryRun: false });
    await runScheduled();

    expect(result.batch).toMatchObject({
      queued: 0,
      skippedDeletingAccounts: 1,
    });
    expect(keys).toEqual([]);
    expect((await card(cardId))?.fileMetadata?.exif?.takenAtClock).toBe(
      undefined
    );
  });
});
