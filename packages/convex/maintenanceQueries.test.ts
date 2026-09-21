/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const insertCard = async (
  ctx: MutationCtx,
  overrides: Partial<Doc<"cards">> = {}
) =>
  await ctx.db.insert("cards", {
    content: "Card",
    createdAt: Date.now(),
    type: "text",
    updatedAt: Date.now(),
    userId: "maintenance-test-user",
    ...overrides,
  });

describe("maintenance queries", () => {
  test("AI backfill returns only old active cards missing every AI field", async () => {
    const t = convexTest(schema, modules);
    const old = Date.now() - 10 * 60 * 1000;
    const ids = await t.run(async (ctx) => ({
      activeFalse: await insertCard(ctx, {
        createdAt: old,
        isDeleted: false,
      }),
      activeUnset: await insertCard(ctx, { createdAt: old }),
      deleted: await insertCard(ctx, {
        createdAt: old,
        isDeleted: true,
      }),
      hasSummary: await insertCard(ctx, {
        aiSummary: "done",
        createdAt: old,
      }),
      hasTags: await insertCard(ctx, {
        aiTags: ["done"],
        createdAt: old,
      }),
      hasTranscript: await insertCard(ctx, {
        aiTranscript: "done",
        createdAt: old,
      }),
      recent: await insertCard(ctx),
    }));

    const result = await t.query(internal["ai/queries"].findCardsMissingAi, {});
    expect(
      new Set(result.map(({ cardId }: { cardId: Id<"cards"> }) => cardId))
    ).toEqual(new Set([ids.activeFalse, ids.activeUnset]));
  });

  test("AI backfill stays capped at fifty cards", async () => {
    const t = convexTest(schema, modules);
    const old = Date.now() - 10 * 60 * 1000;
    await t.run(async (ctx) => {
      for (let index = 0; index < 60; index += 1) {
        await insertCard(ctx, {
          content: `Card ${index}`,
          createdAt: old + index,
          isDeleted: index % 2 === 0 ? undefined : false,
        });
      }
    });

    const result = await t.query(internal["ai/queries"].findCardsMissingAi, {});
    expect(result).toHaveLength(50);
  });

  test("card cleanup returns only deleted cards inside the age range", async () => {
    const t = convexTest(schema, modules);
    const cutoff = Date.now();
    const ids = await t.run(async (ctx) => ({
      active: await insertCard(ctx, { deletedAt: 1 }),
      eligible: await insertCard(ctx, { deletedAt: 1, isDeleted: true }),
      future: await insertCard(ctx, {
        deletedAt: cutoff + 1,
        isDeleted: true,
      }),
      missingTimestamp: await insertCard(ctx, { isDeleted: true }),
    }));

    const result = await t.query(
      internal["workflows/cardCleanup"].getCardsPendingCleanup,
      { limit: 10, olderThan: cutoff }
    );
    expect(result).toEqual([{ _id: ids.eligible }]);
  });
});
