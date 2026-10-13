/// <reference types="vite/client" />
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import {
  ARCHIVE_MIX_SCENARIO_PAGE_SIZE,
  ARCHIVE_MIX_SCENARIO_SIZE,
  archiveMixScenarioCard,
  CARD_DETAILS_SCENARIO_CARDS,
  DEV_SEED_CARDS,
  ORDERING_SCENARIO_PAGE_SIZE,
  ORDERING_SCENARIO_SIZE,
  orderingScenarioCard,
} from "./devSeed";
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

describe("pruning cloud dev accounts", () => {
  const CLOUD_EMAIL = "dev+cloud-0a1b2c3d-main@example.org";

  const withOwner = async (email: string, workosUserId: string) => {
    const t = convexTest(schema, modules);
    workflowTest.register(t);
    workosTest.register(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        teakUserId: `teak_${workosUserId}`,
        identityOrigin: "workos",
        email,
        emailVerified: true,
        workosUserId,
      });
      await ctx.db.insert("cards", {
        userId: `teak_${workosUserId}`,
        content: "seeded",
        type: "text",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    return t;
  };

  const deletionOf = (
    t: Awaited<ReturnType<typeof withOwner>>,
    workosUserId: string
  ) =>
    t.run((ctx) =>
      ctx.db
        .query("accountDeletionStates")
        .withIndex("by_userId", (q) => q.eq("userId", `teak_${workosUserId}`))
        .unique()
    );

  test("starts the full account deletion for a cloud session account", async () => {
    vi.stubEnv("TEAK_DEV_DEPLOYMENT", "true");
    const t = await withOwner(CLOUD_EMAIL, "user_CLOUD");
    expect(
      await t.mutation(internal.devSeed.pruneCloudAccount, {
        workosUserId: "user_CLOUD",
      })
    ).toBe("deleting");
    expect(await deletionOf(t, "user_CLOUD")).toMatchObject({
      workosUserId: "user_CLOUD",
      stage: 0,
    });
  });

  test.each([
    ["the emulator backend", { WORKOS_API_BASE_URL: "http://localhost:4100" }],
    ["a deployment without TEAK_DEV_DEPLOYMENT", {}],
    [
      "TEAK_DEV_DEPLOYMENT set to anything but true",
      { TEAK_DEV_DEPLOYMENT: "1" },
    ],
  ])("refuses to prune on %s", async (_name, env: Record<string, string>) => {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    const t = await withOwner(CLOUD_EMAIL, "user_CLOUD");
    await expect(
      t.mutation(internal.devSeed.pruneCloudAccount, {
        workosUserId: "user_CLOUD",
      })
    ).rejects.toThrow("TEAK_DEV_DEPLOYMENT=true");
    await expect(
      t.query(internal.devSeed.listCloudAccounts, { cursor: null })
    ).rejects.toThrow("TEAK_DEV_DEPLOYMENT=true");
    expect(await deletionOf(t, "user_CLOUD")).toBeNull();
  });

  test.each([
    "dev+praveens-mbp-main@example.org",
    "dev+vm-main@example.org",
    "dev+cloud-0a1b2c3-main@example.org",
    "dev+cloud-0A1B2C3D-main@example.org",
    "dev+cloud-0a1b2c3d-@example.org",
    "dev+cloud-0a1b2c3d-main@example.org.evil.test",
    "dev+cloud-0a1b2c3d-main@example.com",
    "xdev+cloud-0a1b2c3d-main@example.org",
    "someone@gmail.com",
  ])("refuses to prune %s", async (email) => {
    vi.stubEnv("TEAK_DEV_DEPLOYMENT", "true");
    const t = await withOwner(email, "user_OTHER");
    await expect(
      t.mutation(internal.devSeed.pruneCloudAccount, {
        workosUserId: "user_OTHER",
      })
    ).rejects.toThrow("Only cloud session dev accounts");
    expect(await deletionOf(t, "user_OTHER")).toBeNull();
  });

  test("lists only live cloud session accounts", async () => {
    vi.stubEnv("TEAK_DEV_DEPLOYMENT", "true");
    const t = await withOwner(CLOUD_EMAIL, "user_CLOUD");
    await t.run(async (ctx) => {
      const owner = (email: string, workosUserId: string, extra = {}) =>
        ctx.db.insert("users", {
          teakUserId: `teak_${workosUserId}`,
          identityOrigin: "workos",
          email,
          emailVerified: true,
          workosUserId,
          ...extra,
        });
      await owner("dev+cloud-ffffffff-wt-2@example.org", "user_WT");
      await owner("dev+cloud-11111111-main@example.org", "user_GONE", {
        deletedAt: 1,
      });
      await owner("dev+cloud-not-a-hash@example.org", "user_ODD");
      await owner("dev+praveens-mbp-main@example.org", "user_MAC");
      await owner("dev+cloud-22222222-main@example.org", "user_DELETING");
      await ctx.db.insert("accountDeletionStates", {
        userId: "teak_user_DELETING",
        startedAt: 1,
      });
    });
    const page = await t.query(internal.devSeed.listCloudAccounts, {
      cursor: null,
    });
    expect(page.isDone).toBe(true);
    expect(page.accounts).toEqual([
      { email: CLOUD_EMAIL, workosUserId: "user_CLOUD" },
      {
        email: "dev+cloud-ffffffff-wt-2@example.org",
        workosUserId: "user_WT",
      },
    ]);
  });
});

describe("devSeed.seedScenario", () => {
  test("refuses a deployment that trusts hosted WorkOS", async () => {
    const t = await setup();
    await expect(
      t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "card-details",
      })
    ).rejects.toThrow("WorkOS emulator");
    expect(await cardsOf(t)).toHaveLength(0);
  });

  test("adds the card-details pack once, beside existing cards", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    await t.mutation(internal.devSeed.seed, { workosUserId: WORKOS_USER_ID });
    const before = (await cardsOf(t)).length;
    const args = {
      workosUserId: WORKOS_USER_ID,
      scenario: "card-details" as const,
    };
    expect(await t.mutation(internal.devSeed.seedScenario, args)).toEqual({
      status: "seeded",
      cards: CARD_DETAILS_SCENARIO_CARDS.length,
    });
    expect(await t.mutation(internal.devSeed.seedScenario, args)).toEqual({
      status: "already_seeded",
      cards: 0,
    });
    const cards = await cardsOf(t);
    expect(cards).toHaveLength(before + CARD_DETAILS_SCENARIO_CARDS.length);
    const scenario = cards.filter((card) =>
      card.tags?.includes("scenario-card-details")
    );
    expect(scenario.every((card) => card.metadataStatus === "completed")).toBe(
      true
    );
    expect(scenario.filter((card) => card.isDeleted)).toHaveLength(1);
  });
});

describe("devSeed ordering pack", () => {
  test("covers every saved date once, inserted out of date order", () => {
    const cards = Array.from({ length: ORDERING_SCENARIO_SIZE }, (_, index) =>
      orderingScenarioCard(index)
    );
    const dates = cards.map((card) => card.createdAt as number);
    expect(new Set(dates).size).toBe(ORDERING_SCENARIO_SIZE);
    const ascending = [...dates].sort((a, b) => a - b);
    expect(dates).not.toEqual(ascending);
    expect(dates).not.toEqual([...ascending].reverse());
  });

  test("seeds one page at a time, once, and stops after the last page", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    const seedPage = (page: number) =>
      t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "ordering",
        page,
      });
    expect(await seedPage(0)).toEqual({
      status: "seeded",
      cards: ORDERING_SCENARIO_PAGE_SIZE,
    });
    expect(await seedPage(0)).toEqual({ status: "already_seeded", cards: 0 });
    expect(
      await seedPage(ORDERING_SCENARIO_SIZE / ORDERING_SCENARIO_PAGE_SIZE)
    ).toEqual({ status: "already_seeded", cards: 0 });
    const seeded = await t.run((ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_user_deleted", (q) => q.eq("userId", "teak_dev"))
        .collect()
    );
    expect(seeded).toHaveLength(ORDERING_SCENARIO_PAGE_SIZE);
    expect(seeded.some((card) => card.createdAt < Date.UTC(2017, 0, 1))).toBe(
      true
    );
  });
});

describe("devSeed archive-mix pack", () => {
  test("mixes archived, trashed and favorite cards in the planned numbers", () => {
    const cards = Array.from(
      { length: ARCHIVE_MIX_SCENARIO_SIZE },
      (_, index) => archiveMixScenarioCard(index)
    );
    const archived = cards.filter((card) => card.isArchived);
    const trashed = cards.filter((card) => card.isDeleted);
    expect(archived).toHaveLength(200);
    expect(archived.filter((card) => card.isDeleted)).toHaveLength(20);
    expect(trashed.filter((card) => !card.isArchived)).toHaveLength(100);
    expect(archived.some((card) => card.isFavorited)).toBe(true);
    expect(trashed.some((card) => card.isFavorited)).toBe(true);
    const caseVariants = new Set(
      cards
        .flatMap((card) => card.tags ?? [])
        .filter((tag) => tag !== "scenario-archive")
    );
    expect(caseVariants).toEqual(new Set(["Moodboard", "moodboard"]));
  });

  test("seeds archived cards with the date they were archived", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(
      await t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "archive-mix",
        page: 0,
      })
    ).toEqual({ status: "seeded", cards: ARCHIVE_MIX_SCENARIO_PAGE_SIZE });
    const seeded = await t.run((ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_user_deleted", (q) => q.eq("userId", "teak_dev"))
        .collect()
    );
    const archived = seeded.filter((card) => card.isArchived);
    expect(archived.length).toBeGreaterThan(0);
    expect(archived.every((card) => typeof card.archivedAt === "number")).toBe(
      true
    );
  });
});
