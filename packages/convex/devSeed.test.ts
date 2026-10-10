/// <reference types="vite/client" />
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import { DEV_SEED_CARDS } from "./devSeed";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const WORKOS_USER_ID = "user_01TEAKDEVSEED0000000000000";

const setup = async () => {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  workosTest.register(t);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "teak_dev",
      identityOrigin: "workos",
      email: "dev@example.org",
      emailVerified: true,
      workosUserId: WORKOS_USER_ID,
    })
  );
  return t;
};

const cardsOf = (t: Awaited<ReturnType<typeof setup>>) =>
  t.run((ctx) =>
    ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) => q.eq("userId", "teak_dev"))
      .take(100)
  );

// Seeding stops at the committed mutation. Hold the scheduled workflow runs
// so link processing never reaches the network or outlives the test.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("devSeed", () => {
  test("refuses a deployment that trusts hosted WorkOS", async () => {
    const t = await setup();
    await expect(
      t.mutation(internal.devSeed.seed, { workosUserId: WORKOS_USER_ID })
    ).rejects.toThrow("WorkOS emulator");
    expect(await cardsOf(t)).toHaveLength(0);
  });

  test("fills an empty vault once, with one card in the trash", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(
      await t.mutation(internal.devSeed.seed, { workosUserId: WORKOS_USER_ID })
    ).toEqual({ status: "seeded", cards: DEV_SEED_CARDS.length });
    const cards = await cardsOf(t);
    expect(cards).toHaveLength(DEV_SEED_CARDS.length);
    expect(cards.filter((card) => card.isDeleted)).toHaveLength(1);
    expect(
      [...cards]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((card) => card.content)
    ).toEqual(DEV_SEED_CARDS.map((card) => card.content));
    const links = cards.filter((card) => card.type === "link");
    expect(links.length).toBeGreaterThan(0);
    for (const card of links) {
      expect(card).toMatchObject({
        metadataStatus: "pending",
        processingStatus: { metadata: { status: "pending" } },
      });
      expect(card.metadata).toBeUndefined();
      expect(card.metadataTitle).toBeUndefined();
    }
    expect(
      cards
        .filter((card) => card.type !== "link")
        .every(
          (card) => card.processingStatus?.metadata?.status === "completed"
        )
    ).toBe(true);
    const workflows = await t.query(components.workflow.workflow.list, {
      order: "asc",
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(
      workflows.page.map((run: { args: { cardId: string } }) => run.args.cardId)
    ).toEqual(links.map((card) => card._id));
    expect(
      await t.mutation(internal.devSeed.seed, { workosUserId: WORKOS_USER_ID })
    ).toEqual({ status: "already_seeded", cards: 0 });
    expect(await cardsOf(t)).toHaveLength(DEV_SEED_CARDS.length);
  });

  test("seeds the shared dev deployment, which trusts hosted WorkOS staging", async () => {
    vi.stubEnv("TEAK_DEV_DEPLOYMENT", "true");
    const t = await setup();
    expect(
      await t.mutation(internal.devSeed.seed, { workosUserId: WORKOS_USER_ID })
    ).toEqual({ status: "seeded", cards: DEV_SEED_CARDS.length });
  });

  test("fails when the dev account isn't linked yet", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    await expect(
      t.mutation(internal.devSeed.seed, { workosUserId: "user_UNLINKED" })
    ).rejects.toThrow("no Teak owner");
  });
});
