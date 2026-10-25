import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { queuedObjectDeletions } from "../__tests__/helpers/objectDeletions.test-utils";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  EMPTY_TRASH_PAGE_SIZE,
  EMPTY_TRASH_RATE_LIMITED_MESSAGE,
} from "../card/emptyTrash";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import schema from "../schema";
import { cardStorageObjectKeys } from "../storage/r2";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const ownerWorkosId = await seedWorkosOwner(t, "owner");
  await seedWorkosOwner(t, "stranger");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: ownerWorkosId,
    sid: "session_emptytrash",
    email_verified: true,
    external_id: "owner",
  });

  let createdAt = 1000;
  const insert = (seed: Partial<Doc<"cards">> = {}, userId = "owner") => {
    createdAt += 1;
    const at = createdAt;
    return t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId,
        type: "text",
        content: `Card ${at}`,
        createdAt: at,
        updatedAt: at,
        savedAt: at,
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });
  };
  const trashed = (seed: Partial<Doc<"cards">> = {}, userId = "owner") =>
    insert({ isDeleted: true, deletedAt: 5000, ...seed }, userId);

  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId));
  const trashedIds = (userId = "owner") =>
    t.run(async (ctx) =>
      (
        await ctx.db
          .query("cards")
          .withIndex("by_user_deleted_created", (q) =>
            q.eq("userId", userId).eq("isDeleted", true)
          )
          .collect()
      ).map((row) => row._id)
    );
  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);

  return { t, owner, insert, trashed, card, trashedIds, runScheduled };
};

describe("emptyTrash", () => {
  test("deletes every trashed card across pages and leaves the rest", async () => {
    const { owner, insert, trashed, card, trashedIds, runScheduled } =
      await setup();
    const total = EMPTY_TRASH_PAGE_SIZE * 2 + 3;
    for (let index = 0; index < total; index += 1) {
      await trashed();
    }
    const active = await insert();
    const archived = await insert({ isArchived: true });
    const strangers = await trashed({}, "stranger");

    expect(await owner.query(api.cards.trashCount, {})).toEqual({
      count: total,
      more: false,
    });
    expect(await owner.mutation(api.cards.emptyTrash, {})).toEqual({
      count: total,
      more: false,
    });
    // Nothing is deleted until the scheduled pages run.
    expect(await trashedIds()).toHaveLength(total);

    await runScheduled();

    expect(await trashedIds()).toEqual([]);
    expect(await owner.query(api.cards.trashCount, {})).toEqual({
      count: 0,
      more: false,
    });
    expect(await card(active)).not.toBeNull();
    expect(await card(archived)).not.toBeNull();
    expect(await card(strangers)).not.toBeNull();
  });

  test("counts large notes without reading past its byte budget, then deletes them all", async () => {
    const { owner, trashed, trashedIds, runScheduled } = await setup();
    const note = "x".repeat(500 * 1024);
    const total = 24;
    for (let index = 0; index < total; index += 1) {
      await trashed({ content: note });
    }

    const counted = await owner.query(api.cards.trashCount, {});
    expect(counted.more).toBe(true);
    expect(counted.count).toBeLessThan(total);
    expect(await owner.mutation(api.cards.emptyTrash, {})).toEqual(counted);

    await runScheduled();

    expect(await trashedIds()).toEqual([]);
  });

  test("keeps cards moved to Trash after it was called", async () => {
    const { owner, insert, trashed, card, runScheduled } = await setup();
    const before = await trashed();
    const later = await insert();

    expect(await owner.mutation(api.cards.emptyTrash, {})).toEqual({
      count: 1,
      more: false,
    });
    vi.setSystemTime(Date.now() + 10_000);
    await owner.mutation(api.cards.updateCardField, {
      cardId: later,
      field: "delete",
    });

    await runScheduled();

    expect(await card(before)).toBeNull();
    expect(await card(later)).toMatchObject({ isDeleted: true });
  });

  test("keeps a card restored before its delete runs", async () => {
    const { t, owner, trashed, card, runScheduled } = await setup();
    const kept = await trashed();
    const gone = await trashed();

    await owner.mutation(api.cards.emptyTrash, {});
    // Runs the listing page only; each card's delete is still waiting.
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    await owner.mutation(api.cards.updateCardField, {
      cardId: kept,
      field: "restore",
    });

    await runScheduled();

    expect((await card(kept))?.isDeleted).toBeUndefined();
    expect(await card(gone)).toBeNull();
  });

  test("an empty Trash schedules nothing", async () => {
    const { t, owner, insert } = await setup();
    await insert();
    expect(await owner.mutation(api.cards.emptyTrash, {})).toEqual({
      count: 0,
      more: false,
    });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    expect(
      scheduled.filter((job) => job.name.includes("emptyTrashPage"))
    ).toEqual([]);
  });

  test("refuses when signed out", async () => {
    const { t, trashed, trashedIds } = await setup();
    await trashed();
    await expect(t.mutation(api.cards.emptyTrash, {})).rejects.toThrow();
    expect(await t.query(api.cards.trashCount, {})).toEqual({
      count: 0,
      more: false,
    });
    expect(await trashedIds()).toHaveLength(1);
  });

  test("is rate-limited", async () => {
    const { owner } = await setup();
    for (let call = 0; call < 3; call += 1) {
      await owner.mutation(api.cards.emptyTrash, {});
    }
    await expect(owner.mutation(api.cards.emptyTrash, {})).rejects.toThrow(
      EMPTY_TRASH_RATE_LIMITED_MESSAGE
    );
  });

  test("removes each card's files and search row like permanentDeleteCard", async () => {
    const { t, owner, trashed, card, runScheduled } = await setup();
    const withFiles = await trashed({
      type: "document",
      content: "",
      fileKey: "users/owner/cards/c/file/report.pdf",
      thumbnailKey: "users/owner/cards/c/thumbnail/report.webp",
      fileMetadata: { fileName: "report.pdf", mimeType: "application/pdf" },
    });
    const stored = await card(withFiles);
    if (!stored) {
      throw new Error("missing card");
    }
    const keys = cardStorageObjectKeys(stored);
    expect(keys.length).toBeGreaterThan(1);

    await owner.mutation(api.cards.emptyTrash, {});
    await runScheduled();

    expect(await card(withFiles)).toBeNull();
    expect(await queuedObjectDeletions(t)).toEqual(
      expect.arrayContaining(keys)
    );
    const searchRow = await t.run((ctx) =>
      ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (q) => q.eq("cardId", withFiles))
        .unique()
    );
    expect(searchRow).toBeNull();
  });
});
