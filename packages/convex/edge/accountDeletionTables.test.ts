/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { internal } from "../_generated/api";
import { accountDeletionStage } from "../accountDeletion/stages";
import { newBackend } from "./helpers";

const backend = () => newBackend();
type Backend = ReturnType<typeof backend>;

const seedUser = async (t: Backend, teakUserId: string) => {
  await t.run(async (ctx) => {
    for (const date of ["2026-11-01", "2026-11-02"]) {
      await ctx.db.insert("aiUsageDaily", {
        calls: 3,
        costUsd: 0.01,
        date,
        errors: 0,
        inputTokens: 100,
        outputTokens: 20,
        userId: teakUserId,
      });
    }
    await ctx.db.insert("adminUserFlags", {
      aiDisabled: true,
      internal: false,
      teakUserId,
      updatedAt: 1,
    });
  });
};

const rowsOf = (t: Backend, teakUserId: string) =>
  t.run(async (ctx) => ({
    aiUsageDaily: await ctx.db
      .query("aiUsageDaily")
      .withIndex("by_userId_and_date", (q) => q.eq("userId", teakUserId))
      .collect(),
    adminUserFlags: await ctx.db
      .query("adminUserFlags")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
      .collect(),
  }));

describe("account deletion's row sweep", () => {
  test("deletes the account's AI usage and admin flags, and nobody else's", async () => {
    const t = backend();
    const workosUserId = await seedWorkosOwner(t, "owner");
    await seedUser(t, "owner");
    await seedUser(t, "kept");
    const stateId = await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        generation: 1,
        stage: accountDeletionStage("accountData"),
        startedAt: Date.now(),
        userId: "owner",
        workosUserId,
      })
    );
    for (
      let pages = 0;
      pages < 10 &&
      (await t.mutation(internal.accountDeletionData.ancillaryPage, {
        generation: 1,
        stateId,
      }));
      pages += 1
    ) {
      // Each page deletes what it reads; the last one finds nothing.
    }

    expect(await rowsOf(t, "owner")).toEqual({
      aiUsageDaily: [],
      adminUserFlags: [],
    });
    const kept = await rowsOf(t, "kept");
    expect(kept.aiUsageDaily).toHaveLength(2);
    expect(kept.adminUserFlags).toHaveLength(1);
  });
});
