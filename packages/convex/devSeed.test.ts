/// <reference types="vite/client" />
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { DEV_SEED_CARDS } from "./devSeed";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const WORKOS_USER_ID = "user_01TEAKDEVSEED0000000000000";

const setup = async () => {
  const t = convexTest(schema, modules);
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

afterEach(() => {
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
      cards.every(
        (card) => card.processingStatus?.metadata?.status === "completed"
      )
    ).toBe(true);
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
