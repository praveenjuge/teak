/// <reference types="vite/client" />
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import {
  ARCHIVE_MIX_SCENARIO_PAGE_SIZE,
  ARCHIVE_MIX_SCENARIO_SIZE,
  archiveMixScenarioCard,
  CARD_DETAILS_SCENARIO_CARDS,
  CHECKLIST_LONG_ITEMS,
  DEV_SEED_CARDS,
  EXPORT_UGLY_FOLDER_NAMES,
  type FolderScenario,
  HIDDEN_MIX_VOLUME_SIZE,
  hiddenMixVolumeCard,
  ORDERING_SCENARIO_PAGE_SIZE,
  ORDERING_SCENARIO_SIZE,
  orderingScenarioCard,
  PALETTE_MIXED_SMART_FOLDERS,
  REVISIT_SIZE_GROUPS,
  SAVE_DETAILS_SAVED_URL,
  SEARCH_QUALIFIER_HOSTS,
  SEARCH_QUALIFIERS_VOLUME_PAGE_SIZE,
  SEARCH_QUALIFIERS_VOLUME_SIZE,
  SHUFFLE_PARTIAL_SCENARIO_SIZE,
  searchQualifiersVolumeCard,
  TAGS_2000_SCENARIO_PAGE_SIZE,
  TAGS_2000_SCENARIO_SIZE,
  TAGS_CASE_SCENARIO_CARDS,
  tags2000ScenarioCard,
  UGLY_FOLDER_NAMES,
} from "./devSeed";
import schema from "./schema";
import {
  MAX_FOLDERS_PER_CARD,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "./shared/folders";
import { MARKDOWN_CONTENT_MAX_BYTES } from "./shared/markdown";

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
    // Only the links are processed: one queued run each.
    const runs = await t.run((ctx) =>
      ctx.db.query("workflowDispatches").collect()
    );
    expect(
      runs
        .filter((run) => run.kind === "cardProcessing")
        .map((run) => run.cardId)
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

  test("an unknown scenario lists every pack with what it seeds", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    const error = await t
      .mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "toString",
      })
      .then(
        () => null,
        (rejection: Error) => rejection.message
      );
    expect(error).toContain("Unknown scenario");
    expect(error).toContain(
      "  card-in-50-folders: One card in 50 folders, one in 49"
    );
    expect(error).toContain("  shuffle-partial: 400 cards");
    expect(await cardsOf(t)).toHaveLength(0);
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

describe("devSeed keyboard-mixed pack", () => {
  test("seeds tall and wide blocks beside short cards, once", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    const seed = () =>
      t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "keyboard-mixed",
      });
    expect(await seed()).toEqual({ status: "seeded", cards: 48 });
    expect(await seed()).toEqual({ status: "already_seeded", cards: 0 });
    const seeded = await t.run((ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_user_deleted", (q) => q.eq("userId", "teak_dev"))
        .collect()
    );
    const pack = seeded.filter((card) =>
      card.tags?.includes("scenario-keyboard-mixed")
    );
    expect(pack).toHaveLength(48);
    const ratios = pack
      .filter((card) => card.type === "image")
      .map(
        (card) =>
          (card.fileMetadata?.height ?? 0) / (card.fileMetadata?.width ?? 1)
      );
    expect(Math.max(...ratios)).toBeGreaterThanOrEqual(3);
    expect(Math.min(...ratios)).toBeLessThan(1);
    expect(pack.filter((card) => card.type === "text").length).toBeGreaterThan(
      0
    );
  });
});

describe("devSeed shuffle-partial pack", () => {
  test("seeds 300 cards without a Shuffle key beside keyed ones, once", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    const seed = (page: number) =>
      t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "shuffle-partial",
        page,
      });
    expect(await seed(0)).toEqual({ status: "seeded", cards: 200 });
    expect(await seed(1)).toEqual({ status: "seeded", cards: 200 });
    expect(await seed(2)).toEqual({ status: "already_seeded", cards: 0 });
    expect(await seed(0)).toEqual({ status: "already_seeded", cards: 0 });
    const pack = (
      await t.run((ctx) =>
        ctx.db
          .query("cards")
          .withIndex("by_user_deleted", (q) => q.eq("userId", "teak_dev"))
          .collect()
      )
    ).filter((card) => card.tags?.includes("scenario-shuffle-partial"));
    expect(pack).toHaveLength(SHUFFLE_PARTIAL_SCENARIO_SIZE);
    expect(pack.filter((card) => card.shuffleKey === undefined)).toHaveLength(
      300
    );
  });
});

describe("devSeed tag packs", () => {
  test("tags-2000 spreads 2,000 distinct tags over 1,000 cards", () => {
    const cards = Array.from({ length: TAGS_2000_SCENARIO_SIZE }, (_, index) =>
      tags2000ScenarioCard(index)
    );
    const tags = new Set(cards.flatMap((card) => card.tags ?? []));
    const topics = [...tags].filter((tag) => tag.startsWith("topic-"));
    expect(topics).toHaveLength(2000);
    expect(tags.has("design")).toBe(true);
    expect(cards.filter((card) => card.tags?.includes("design"))).toHaveLength(
      500
    );
  });

  test("tags-case seeds case variants once, in Trash and Archive too", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    const seed = () =>
      t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "tags-case",
      });
    expect(await seed()).toEqual({
      status: "seeded",
      cards: TAGS_CASE_SCENARIO_CARDS.length,
    });
    expect(await seed()).toEqual({ status: "already_seeded", cards: 0 });
    const seeded = await t.run((ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_user_deleted", (q) => q.eq("userId", "teak_dev"))
        .collect()
    );
    const variants = new Set(
      seeded
        .flatMap((card) => [...(card.tags ?? []), ...(card.aiTags ?? [])])
        .filter((tag) => tag.toLowerCase() === "design")
    );
    expect(variants).toEqual(new Set(["Design", "design", "DESIGN"]));
    expect(seeded.some((card) => card.isDeleted)).toBe(true);
    expect(seeded.some((card) => card.isArchived)).toBe(true);
  });

  test("tags-2000 seeds in pages", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(
      await t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "tags-2000",
        page: 4,
      })
    ).toEqual({ status: "seeded", cards: TAGS_2000_SCENARIO_PAGE_SIZE });
    expect(
      await t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "tags-2000",
        page: 5,
      })
    ).toEqual({ status: "already_seeded", cards: 0 });
  });
});

describe("devSeed folder packs", () => {
  const seedFolders = (
    t: Awaited<ReturnType<typeof setup>>,
    scenario: FolderScenario
  ) =>
    t.mutation(internal.devSeed.seedScenario, {
      workosUserId: WORKOS_USER_ID,
      scenario,
    });
  const foldersOf = (t: Awaited<ReturnType<typeof setup>>) =>
    t.run((ctx) =>
      ctx.db
        .query("folders")
        .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", "teak_dev"))
        .collect()
    );

  test("folders-one counts only the folder's active cards, once", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "folders-one")).toEqual({
      status: "seeded",
      cards: 15,
      folders: 1,
    });
    expect(await seedFolders(t, "folders-one")).toEqual({
      status: "already_seeded",
      cards: 0,
      folders: 0,
    });
    const [folder] = await foldersOf(t);
    expect(folder.name).toBe("Scenario folder");
    expect(folder.activeCardCount).toBe(8);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("folderCards")
        .withIndex("by_userId", (q) => q.eq("userId", "teak_dev"))
        .collect()
    );
    expect(rows).toHaveLength(12);
    expect(rows.filter((row) => row.isArchived)).toHaveLength(3);
    expect(rows.filter((row) => row.isDeleted)).toHaveLength(2);
  });

  test("folders-500 fills the cap and stops there", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    await seedFolders(t, "folders-one");
    expect(await seedFolders(t, "folders-500")).toEqual({
      status: "seeded",
      cards: 3,
      folders: 499,
    });
    expect(await foldersOf(t)).toHaveLength(500);
    const first = (await foldersOf(t)).find(
      (folder) => folder.name === "Folder 001"
    );
    expect(first?.activeCardCount).toBe(3);
  });

  test("card-in-50-folders puts one card at the per-card cap", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    await seedFolders(t, "card-in-50-folders");
    const cards = await cardsOf(t);
    expect(cards.map((card) => card.folderIds?.length).sort()).toEqual([
      49, 50,
    ]);
    const folders = await foldersOf(t);
    expect(folders).toHaveLength(51);
    expect(
      folders.find((folder) => folder.name === "Stack 51")?.activeCardCount
    ).toBe(0);
  });

  test("folders-ugly keeps one folder per name ignoring case", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "folders-ugly")).toMatchObject({
      status: "seeded",
      cards: UGLY_FOLDER_NAMES.length,
      folders: UGLY_FOLDER_NAMES.length - 2,
    });
    const folders = await foldersOf(t);
    const ideas = folders.find((folder) => folder.nameKey === "ideas");
    expect(ideas?.name).toBe("Ideas");
    expect(ideas?.activeCardCount).toBe(3);
    expect(
      folders.some((folder) => Array.from(folder.name).length === 300)
    ).toBe(true);
  });

  test("search-qualifiers seeds its hosts once, every way of writing one host as one site", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "search-qualifiers")).toMatchObject({
      status: "seeded",
      cards: SEARCH_QUALIFIER_HOSTS.length + 7,
      folders: 4,
    });
    expect(await seedFolders(t, "search-qualifiers")).toMatchObject({
      status: "already_seeded",
      cards: 0,
    });
    const hosts = await t.run(async (ctx) => {
      const counts = new Map<string, number>();
      for (const card of await ctx.db
        .query("cards")
        .withIndex("by_user_deleted", (q) => q.eq("userId", "teak_dev"))
        .collect()) {
        if (card.urlHost) {
          counts.set(card.urlHost, (counts.get(card.urlHost) ?? 0) + 1);
        }
      }
      return Object.fromEntries(counts);
    });
    expect(hosts).toMatchObject({
      "github.com": 3,
      "gist.github.com": 1,
      "xn--r8jz45g.jp": 2,
      "xn--bcher-kva.example": 1,
      "192.168.1.20": 1,
      "example.com": 3,
    });
  });

  test("focus-notes seeds its notes once, the long one under the note cap", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "focus-notes")).toMatchObject({
      status: "seeded",
      cards: 6,
    });
    expect(await seedFolders(t, "focus-notes")).toMatchObject({
      status: "already_seeded",
      cards: 0,
    });
    const notes = (await cardsOf(t)).filter((card) => card.type === "text");
    const longest = Math.max(
      ...notes.map((card) => new TextEncoder().encode(card.content).length)
    );
    expect(longest).toBeGreaterThan(250_000);
    expect(longest).toBeLessThanOrEqual(MARKDOWN_CONTENT_MAX_BYTES);
    expect(notes.some((card) => card.content === "")).toBe(true);
  });

  test("checklists seeds its notes once, with 200 open items in the long one", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "checklists")).toMatchObject({
      status: "seeded",
      cards: 9,
    });
    expect(await seedFolders(t, "checklists")).toMatchObject({
      status: "already_seeded",
      cards: 0,
    });
    const long = (await cardsOf(t)).find((card) =>
      card.content.startsWith("# Long checklist")
    );
    expect(long?.content.match(/^- \[ \] /gm)).toHaveLength(
      CHECKLIST_LONG_ITEMS
    );
  });

  test("hidden-mix seeds once and flags only the reserved user tags", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "hidden-mix")).toMatchObject({
      status: "seeded",
      cards: 12,
      folders: 3,
    });
    expect(await seedFolders(t, "hidden-mix")).toMatchObject({
      status: "already_seeded",
      cards: 0,
    });
    const cards = await cardsOf(t);
    const hidden = cards.filter((card) => card.isHidden === true);
    expect(hidden).toHaveLength(8);
    expect(
      hidden.every(
        (card) =>
          card.metadataTitle?.startsWith("Hidden") ||
          card.content.startsWith("Hidden")
      )
    ).toBe(true);
    expect(
      cards.find((card) => card.aiTags?.includes("hidden"))?.isHidden
    ).toBeUndefined();
  });

  test("revisit-sizes seeds its tag groups once, each with one hidden card", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "revisit-sizes")).toMatchObject({
      status: "seeded",
      cards: 67,
      folders: 0,
    });
    expect(await seedFolders(t, "revisit-sizes")).toMatchObject({
      status: "already_seeded",
      cards: 0,
    });
    const cards = await cardsOf(t);
    for (const size of REVISIT_SIZE_GROUPS) {
      const group = cards.filter((card) => card.tags?.includes(`rv${size}`));
      expect(group.filter((card) => card.isHidden !== true)).toHaveLength(size);
      expect(group.filter((card) => card.isHidden === true)).toHaveLength(1);
    }
    const types = new Set(
      cards.filter((card) => card.tags?.includes("rv21")).map((c) => c.type)
    );
    expect([...types].sort()).toEqual([
      "audio",
      "document",
      "image",
      "link",
      "palette",
      "quote",
      "text",
      "video",
    ]);
  });

  test("save-details seeds text from pages and a page already saved", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "save-details")).toMatchObject({
      status: "seeded",
      cards: 7,
    });
    expect(await seedFolders(t, "save-details")).toMatchObject({
      status: "already_seeded",
    });
    const cards = await cardsOf(t);
    const sourced = cards.filter(
      (card) => card.type === "text" && card.sourceUrl
    );
    expect(sourced.map((card) => card.urlHost).sort()).toEqual([
      "example.com",
      "example.net",
      "example.org",
      "xn--r8jz45g.jp",
    ]);
    expect(
      sourced.find((card) => card.urlHost === "example.org")?.sourceTitle
    ).toHaveLength(300);
    expect(
      cards.find((card) => card.url === SAVE_DETAILS_SAVED_URL)
    ).toMatchObject({ notes: "Saved earlier, with a note." });
    expect(
      cards.find((card) => card.url === "https://github.com/acme/design-system")
    ).toMatchObject({
      sourceUrl: "https://example.com/where-i-found-it",
      urlHost: "github.com",
    });
  });

  test("card-limit-199 fills the library to one under the free limit", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    await t.mutation(internal.devSeed.seed, { workosUserId: WORKOS_USER_ID });
    // Cards in Trash don't count toward the limit.
    const active = () =>
      t.run((ctx) =>
        ctx.db
          .query("cards")
          .withIndex("by_user_deleted", (q) =>
            q.eq("userId", "teak_dev").eq("isDeleted", undefined)
          )
          .take(300)
      );
    const before = (await active()).length;
    const seed = () =>
      t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "card-limit-199",
      });
    expect(await seed()).toEqual({ status: "seeded", cards: 199 - before });
    expect(await seed()).toEqual({ status: "already_seeded", cards: 0 });
    expect(await active()).toHaveLength(199);
  });

  test("palette-mixed seeds 50 folders and 10 smart folders once", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "palette-mixed")).toMatchObject({
      status: "seeded",
      cards: 8,
      folders: 60,
    });
    expect(await seedFolders(t, "palette-mixed")).toMatchObject({
      status: "already_seeded",
      cards: 0,
      folders: 0,
    });
    const folders = await foldersOf(t);
    expect(folders.filter((folder) => folder.kind === "smart")).toHaveLength(
      PALETTE_MIXED_SMART_FOLDERS.length - 1
    );
    expect(folders.filter((folder) => folder.kind === "manual")).toHaveLength(
      50
    );
    expect(
      folders.find((folder) => folder.nameKey === "smart ideas")?.name
    ).toBe("Smart IDEAS");
  });

  test("smart-folders seeds smart folders with canonical searches once", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "smart-folders")).toMatchObject({
      status: "seeded",
      cards: 9,
      folders: 9,
    });
    expect(await seedFolders(t, "smart-folders")).toMatchObject({
      status: "already_seeded",
      cards: 0,
      folders: 0,
    });
    const folders = await foldersOf(t);
    const smart = folders.filter((folder) => folder.kind === "smart");
    expect(smart).toHaveLength(8);
    const byName = new Map(folders.map((folder) => [folder.name, folder]));
    expect(byName.get("Reading list")?.kind).toBe("manual");
    expect(byName.get("Design links")?.query).toBe("tag:design type:link");
    expect(byName.get("🎨 Moodboard ✨")?.query).toBe("tag:design tag:🎨");
    expect(byName.get("Favorite reading")?.query).toBe(
      'folder:"Reading list" is:fav'
    );
    const long = byName.get("Five hundred characters")?.query ?? "";
    expect(long.length).toBeGreaterThan(450);
    expect(long.length).toBeLessThanOrEqual(MAX_SMART_FOLDER_QUERY_LENGTH);
  });

  test("export-ugly seeds awkward names, a card in 50 folders, once", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "export-ugly")).toMatchObject({
      status: "seeded",
      cards: 12,
      folders: EXPORT_UGLY_FOLDER_NAMES.length + MAX_FOLDERS_PER_CARD,
    });
    expect(await seedFolders(t, "export-ugly")).toMatchObject({
      status: "already_seeded",
      cards: 0,
      folders: 0,
    });
    const names = new Set((await foldersOf(t)).map((folder) => folder.name));
    for (const name of EXPORT_UGLY_FOLDER_NAMES) {
      expect(names.has(name)).toBe(true);
    }
    const cards = await t.run((ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_user_deleted", (q) => q.eq("userId", "teak_dev"))
        .collect()
    );
    expect(
      cards.find((card) => card.metadataTitle === "In 50 folders")?.folderIds
    ).toHaveLength(MAX_FOLDERS_PER_CARD);
    expect(cards.filter((card) => card.isArchived)).toHaveLength(2);
    expect(cards.filter((card) => card.aiSummary)).toHaveLength(6);
    expect(cards.filter((card) => card.type === "link")).toHaveLength(8);
    expect(cards.filter((card) => card.type === "quote")).toHaveLength(1);
  });

  test("hidden-mix-1000 tags 200 of the ordering pack's cards secret", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    const seed = (page: number) =>
      t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "hidden-mix-1000",
        page,
      });
    expect(await seed(0)).toEqual({ status: "seeded", cards: 200 });
    expect(await seed(0)).toEqual({ status: "already_seeded", cards: 0 });
    expect(await seed(5)).toEqual({ status: "already_seeded", cards: 0 });
    const cards = Array.from({ length: HIDDEN_MIX_VOLUME_SIZE }, (_, index) =>
      hiddenMixVolumeCard(index)
    );
    expect(cards.filter((card) => card.tags?.includes("secret"))).toHaveLength(
      200
    );
  });

  test("search-qualifiers-1000 seeds in pages", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    const seed = (page: number) =>
      t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "search-qualifiers-1000",
        page,
      });
    expect(await seed(4)).toEqual({
      status: "seeded",
      cards: SEARCH_QUALIFIERS_VOLUME_PAGE_SIZE,
    });
    expect(await seed(4)).toEqual({ status: "already_seeded", cards: 0 });
    expect(await seed(5)).toEqual({ status: "already_seeded", cards: 0 });
    const cards = Array.from(
      { length: SEARCH_QUALIFIERS_VOLUME_SIZE },
      (_, index) => searchQualifiersVolumeCard(index)
    );
    expect(
      cards.filter((card) => card.url?.includes("//noise.example/"))
    ).toHaveLength(900);
  });
});
