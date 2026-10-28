import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { claimAiBackfillCard, MAX_AI_BACKFILL_ATTEMPTS } from "../ai/backfill";
import { AI_BACKFILL_SCAN_LIMIT } from "../ai/queries";
import { syncCardSearch } from "../card/searchSync";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const NOW = new Date("2026-10-28T10:00:00Z").getTime();
const HOUR_MS = 60 * 60 * 1000;
const DELETING_USER = "deleting-user";
const OWNER = "owner";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = ReturnType<typeof convexTest>;

// Cards saved through the app: search sync sets `aiPending`. Older cards
// come first in the backfill's index, so `offset` orders them.
const saveCards = (
  t: T,
  count: number,
  fields: Partial<Doc<"cards">> & { userId: string },
  offset = 0
) =>
  t.run(async (ctx) => {
    const ids: Id<"cards">[] = [];
    for (let index = 0; index < count; index += 1) {
      const cardId = await ctx.db.insert("cards", {
        content: `Card ${index}`,
        createdAt: NOW - 2 * HOUR_MS + offset + index,
        type: "text",
        updatedAt: NOW - 2 * HOUR_MS,
        ...fields,
      });
      await syncCardSearch(ctx, cardId);
      ids.push(cardId);
    }
    return ids;
  });

// A deletion that stopped for an operator: its row stays, so the account's
// batches still own every card it has.
const stallAccountDeletion = (t: T, userId: string) =>
  t.run((ctx) =>
    ctx.db.insert("accountDeletionStates", {
      failureCode: "cards_storage_source_changed",
      startedAt: NOW - HOUR_MS,
      userId,
    })
  );

const card = (t: T, cardId: Id<"cards">) =>
  t.run((ctx) => ctx.db.get("cards", cardId));

describe("AI backfill while an account deletion is stalled", () => {
  test("pages past the deleting account's oldest cards to claim everyone else's", async () => {
    const t = convexTest(schema, modules);
    const stalled = await saveCards(t, 60, { userId: DELETING_USER });
    const [ownerCard] = await saveCards(t, 1, { userId: OWNER }, 1000);
    await stallAccountDeletion(t, DELETING_USER);

    const claimed = await t.mutation(
      internal.ai.backfill.claimAiBackfillCards,
      {}
    );

    expect(claimed).toEqual({
      cards: [{ cardId: ownerCard, rev: 0 }],
      exhausted: 0,
    });
    expect((await card(t, ownerCard))?.aiBackfillAttempts).toBe(1);
    for (const cardId of stalled) {
      expect((await card(t, cardId))?.aiBackfillAttempts).toBeUndefined();
    }
  });

  test("exhausted cards of a deleting account no longer block the batch", async () => {
    const t = convexTest(schema, modules);
    const stalled = await saveCards(t, 50, {
      aiBackfillAttempts: MAX_AI_BACKFILL_ATTEMPTS,
      userId: DELETING_USER,
    });
    const [ownerCard] = await saveCards(t, 1, { userId: OWNER }, 1000);
    await stallAccountDeletion(t, DELETING_USER);

    const claimed = await t.mutation(
      internal.ai.backfill.claimAiBackfillCards,
      {}
    );

    expect(claimed).toEqual({
      cards: [{ cardId: ownerCard, rev: 0 }],
      exhausted: 0,
    });
    for (const cardId of stalled) {
      const row = await card(t, cardId);
      expect(row?.aiPending).toBe(true);
      expect(row?.processingStatus?.metadata).toBeUndefined();
    }
  });

  test("the admin pending sample leaves out the deleting account's cards", async () => {
    const t = convexTest(schema, modules);
    await saveCards(t, 60, { userId: DELETING_USER });
    const owners = await saveCards(t, 2, { userId: OWNER }, 1000);
    await stallAccountDeletion(t, DELETING_USER);

    const pending = await t.query(internal.ai.queries.findCardsMissingAi, {});

    expect(pending).toEqual(owners.map((cardId) => ({ cardId })));
  });

  test("a stalled deletion's cards at the oldest end don't hide newer ones", async () => {
    const t = convexTest(schema, modules);
    await saveCards(t, AI_BACKFILL_SCAN_LIMIT, { userId: DELETING_USER });
    const owners = await saveCards(t, 1, { userId: OWNER }, 10_000);
    await stallAccountDeletion(t, DELETING_USER);

    expect(await t.query(internal.ai.queries.findCardsMissingAi, {})).toEqual(
      owners.map((cardId) => ({ cardId }))
    );
  });

  test("stops after its read budget instead of scanning every pending card", async () => {
    const t = convexTest(schema, modules);
    await saveCards(t, AI_BACKFILL_SCAN_LIMIT, { userId: DELETING_USER });
    await saveCards(t, 1, { userId: OWNER }, 10_000);
    await saveCards(
      t,
      AI_BACKFILL_SCAN_LIMIT,
      { userId: DELETING_USER },
      20_000
    );
    await stallAccountDeletion(t, DELETING_USER);

    expect(await t.query(internal.ai.queries.findCardsMissingAi, {})).toEqual(
      []
    );
  });

  test("a claim leaves a deleting account's card untouched", async () => {
    const t = convexTest(schema, modules);
    const [cardId] = await saveCards(t, 1, {
      aiBackfillAttempts: 1,
      userId: DELETING_USER,
    });
    await stallAccountDeletion(t, DELETING_USER);

    expect(await t.run((ctx) => claimAiBackfillCard(ctx, cardId))).toEqual({
      outcome: "skipped",
    });
    expect((await card(t, cardId))?.aiBackfillAttempts).toBe(1);
  });

  test("releasing a claim leaves a deleting account's card untouched", async () => {
    const t = convexTest(schema, modules);
    const [cardId] = await saveCards(t, 1, {
      aiBackfillAttempts: 2,
      userId: DELETING_USER,
    });
    await stallAccountDeletion(t, DELETING_USER);

    await t.mutation(internal.ai.backfill.releaseAiBackfillCards, {
      cardIds: [cardId],
    });

    expect((await card(t, cardId))?.aiBackfillAttempts).toBe(2);
  });
});
