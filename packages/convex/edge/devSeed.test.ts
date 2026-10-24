import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { readCardTranscript } from "../card/textContents";
import { DEV_SEED_CARDS } from "../devSeed";
import { AI_LANGUAGE_CASES, AI_LANGUAGES_TAG } from "../devSeed/aiLanguages";
import {
  CARD_DETAILS_SCENARIO_CARDS,
  TAGS_CASE_SCENARIO_CARDS,
} from "../devSeed/cardScenarios";
import {
  CHECKLIST_LONG_ITEMS,
  NOTE_TABLES_LARGE_BYTES,
  NOTE_TABLES_WIDE,
  OCR_LEASE_PHRASE,
  OCR_SHARED_KEYWORD,
  OMNIBOX_HIDDEN_TITLE,
  REVISIT_SIZE_GROUPS,
  SAVE_DETAILS_SAVED_URL,
} from "../devSeed/contentPacks";
import {
  EXPORT_UGLY_FOLDER_NAMES,
  type FolderScenario,
  PALETTE_MIXED_SMART_FOLDERS,
  SEARCH_QUALIFIER_HOSTS,
  UGLY_FOLDER_NAMES,
} from "../devSeed/folderPacks";
import {
  SEARCH_OPERATOR_ARCHIVED,
  SEARCH_OPERATOR_COUNTS,
  SEARCH_OPERATOR_TOTAL,
} from "../devSeed/searchOperators";
import {
  ARCHIVE_MIX_SCENARIO_PAGE_SIZE,
  ARCHIVE_MIX_SCENARIO_SIZE,
  archiveMixScenarioCard,
  HIDDEN_MIX_VOLUME_SIZE,
  hiddenMixVolumeCard,
  ORDERING_SCENARIO_PAGE_SIZE,
  ORDERING_SCENARIO_SIZE,
  orderingScenarioCard,
  SEARCH_QUALIFIERS_VOLUME_PAGE_SIZE,
  SEARCH_QUALIFIERS_VOLUME_SIZE,
  SHUFFLE_PARTIAL_SCENARIO_SIZE,
  searchQualifiersVolumeCard,
  TAGS_2000_SCENARIO_PAGE_SIZE,
  TAGS_2000_SCENARIO_SIZE,
  tags2000ScenarioCard,
} from "../devSeed/volumeScenarios";
import { readFolderCardCount } from "../folder/folderRows";
import schema from "../schema";
import {
  MAX_FOLDERS_PER_CARD,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "../shared/folders";
import { LINK_CATEGORIES } from "../shared/linkCategories";
import { MARKDOWN_CONTENT_MAX_BYTES } from "../shared/markdown";
import { filterLocalCards } from "../shared/search/localSearch";
import { buildRawSelectorMap } from "../workflows/steps/categorization/enrichment";
import { findFeedUrl } from "../workflows/steps/podcast/resolveEnclosure";

const modules = import.meta.glob("../**/*.ts");
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

// Each card with its transcript, which lives in `cardTextContents`.
const cardsOf = (t: Awaited<ReturnType<typeof setup>>) =>
  t.run(async (ctx) => {
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted_created", (q) => q.eq("userId", "teak_dev"))
      .take(100);
    return await Promise.all(
      cards.map(async (card) => ({
        ...card,
        aiTranscript: await readCardTranscript(ctx, card),
      }))
    );
  });

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

describe("devSeed card link packs", () => {
  const seedPack = async (scenario: "card-links" | "backlinks") => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    const args = { workosUserId: WORKOS_USER_ID, scenario };
    const first = await t.mutation(internal.devSeed.seedScenario, args);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const again = await t.mutation(internal.devSeed.seedScenario, args);
    const rows = await t.run((ctx) => ctx.db.query("cardLinks").take(2000));
    return { again, first, rows, t };
  };

  test("card-links links real cards, caps a note at 500, and runs once", async () => {
    const { again, first, rows } = await seedPack("card-links");
    expect(first).toMatchObject({ status: "seeded" });
    expect(again).toEqual({ status: "already_seeded", cards: 0 });
    // Each of the 500- and 501-link notes indexes the 120 real targets;
    // the broken-links note keeps its 6 real targets (in Trash, renamed,
    // 300-character, RTL, CJK, emoji), not the deleted or unknown ids;
    // the cycle has 3 rows and the code note 1.
    const byNote = new Map<string, number>();
    for (const row of rows) {
      byNote.set(row.fromCardId, (byNote.get(row.fromCardId) ?? 0) + 1);
    }
    expect([...byNote.values()].sort((a, b) => a - b)).toEqual([
      1, 1, 1, 1, 6, 120, 120,
    ]);
    expect(rows.every((row) => row.fromCardId !== row.toCardId)).toBe(true);
  });

  test("backlinks gives the hub 60 and the crowded card 120", async () => {
    const { again, rows } = await seedPack("backlinks");
    expect(again).toEqual({ status: "already_seeded", cards: 0 });
    const byTarget = new Map<string, number>();
    for (const row of rows) {
      byTarget.set(row.toCardId, (byTarget.get(row.toCardId) ?? 0) + 1);
    }
    expect([...byTarget.values()].sort((a, b) => a - b)).toEqual([
      1, 1, 60, 120,
    ]);
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
        .withIndex("by_user_deleted_created", (q) => q.eq("userId", "teak_dev"))
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
        .withIndex("by_user_deleted_created", (q) => q.eq("userId", "teak_dev"))
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
        .withIndex("by_user_deleted_created", (q) => q.eq("userId", "teak_dev"))
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
          .withIndex("by_user_deleted_created", (q) =>
            q.eq("userId", "teak_dev")
          )
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
        .withIndex("by_user_deleted_created", (q) => q.eq("userId", "teak_dev"))
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
    t.run(async (ctx) => {
      const folders = await ctx.db
        .query("folders")
        .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", "teak_dev"))
        .collect();
      return await Promise.all(
        folders.map(async (folder) => ({
          ...folder,
          activeCardCount: await readFolderCardCount(ctx, folder),
        }))
      );
    });

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
        .withIndex("by_user_deleted_created", (q) => q.eq("userId", "teak_dev"))
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

  test("search-operators gives each operator its own answer", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "search-operators")).toMatchObject({
      status: "seeded",
      cards: SEARCH_OPERATOR_TOTAL,
    });
    expect(await seedFolders(t, "search-operators")).toMatchObject({
      status: "already_seeded",
      cards: 0,
    });
    const folders = await foldersOf(t);
    const scope = "tag:scenario-search-operators";
    expect(
      folders.filter((folder) => folder.query).map((folder) => folder.query)
    ).toEqual([
      `${scope} (tag:fonts OR tag:type)`,
      `${scope} -is:archived`,
      `${scope} (site:github.com OR site:gitlab.com)`,
    ]);
    const cards = await t.run((ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_user_deleted_created", (q) => q.eq("userId", "teak_dev"))
        .collect()
    );
    expect(cards).toHaveLength(SEARCH_OPERATOR_TOTAL);
    const count = (query: string) =>
      filterLocalCards(cards, { searchTerms: `${scope} (${query})` }).length;
    const counts = SEARCH_OPERATOR_COUNTS;
    const archived =
      SEARCH_OPERATOR_ARCHIVED.github + SEARCH_OPERATOR_ARCHIVED.gitlab;
    const fonts = counts.fonts + counts.fontsCaseVariant + counts.fontsAndType;
    expect(count("design")).toBe(counts.designNotes + counts.figmaNotes);
    expect(count("design -figma")).toBe(counts.designNotes);
    expect(count("#inspo -type:image")).toBe(counts.inspoLinks);
    expect(count("tag:fonts OR tag:type")).toBe(fonts + counts.type);
    expect(count("(site:github.com OR site:gitlab.com) -is:archived")).toBe(
      counts.github + counts.gitlab - archived
    );
    expect(count("(site:github.com OR site:gitlab.com) is:archived")).toBe(
      archived
    );
    expect(count("tag:hidden OR tag:fonts")).toBe(fonts + counts.hidden);
    expect(count("-tag:hidden diary")).toBe(0);
    expect(count('-"brand guide" guide')).toBe(0);
    expect(count('text:"total due"')).toBe(counts.receipts);
    expect(count('"total due" -type:image')).toBe(counts.receiptNotes);
    // Prices are 20, 40, … 400.
    expect(count("price:<100 OR price:>300")).toBe(4 + 5);
    expect(
      folders
        .filter((folder) => ["Inbox", "Reading list"].includes(folder.name))
        .map((folder) => folder.activeCardCount)
    ).toEqual([
      counts.inbox + counts.inBoth,
      counts.readingList + counts.inBoth,
    ]);
  });

  test("note-tables seeds its notes once, within the Markdown limit", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "note-tables")).toMatchObject({
      status: "seeded",
      cards: 13,
    });
    expect(await seedFolders(t, "note-tables")).toMatchObject({
      status: "already_seeded",
      cards: 0,
    });
    const notes = await cardsOf(t);
    const sizes = notes.map(
      (card) => new TextEncoder().encode(card.content).length
    );
    expect(Math.max(...sizes)).toBeGreaterThan(NOTE_TABLES_LARGE_BYTES - 1024);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MARKDOWN_CONTENT_MAX_BYTES);
    const wide = notes.find((card) =>
      card.content.startsWith("# A 20 × 200 table")
    );
    const rows = wide?.content
      .split("\n")
      .filter((line) => line.startsWith("|"));
    expect(rows).toHaveLength(NOTE_TABLES_WIDE.rows + 1);
    expect(rows?.[0].split(" | ")).toHaveLength(NOTE_TABLES_WIDE.cols);
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

  test("omnibox-titles seeds titles to escape and one hidden card", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "omnibox-titles")).toMatchObject({
      status: "seeded",
      cards: 11,
    });
    const cards = await cardsOf(t);
    const titles = cards.map((card) => card.metadataTitle);
    expect(titles).toContain("Omnibox <script>alert(1)</script>");
    expect(titles).toContain("");
    expect(titles.some((title) => title?.length === 300)).toBe(true);
    expect(
      cards.find((card) => card.metadataTitle === OMNIBOX_HIDDEN_TITLE)?.tags
    ).toContain("secret");
  });

  test("ocr-images seeds image text and twin notes for text:", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "ocr-images")).toMatchObject({
      status: "seeded",
      cards: 45,
    });
    const cards = await cardsOf(t);
    const read = cards.filter((card) => card.aiOcrText);
    expect(read).toHaveLength(35);
    expect(read.every((card) => card.ocrCheckedAt !== undefined)).toBe(true);
    expect(
      cards.filter(
        (card) =>
          (card.type === "image" || card.type === "video") && !card.aiOcrText
      )
    ).toHaveLength(5);
    expect(Math.max(...read.map((card) => card.aiOcrText?.length ?? 0))).toBe(
      4000
    );
    const shared = cards.filter((card) =>
      [card.aiOcrText, card.content].some((text) =>
        text?.includes(OCR_SHARED_KEYWORD)
      )
    );
    expect(shared.map((card) => card.type).sort()).toEqual([
      "image",
      "text",
      "video",
    ]);
  });

  test("ocr-documents seeds scanned PDFs read for text:, controls and a twin note", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "ocr-documents")).toMatchObject({
      status: "seeded",
      cards: 10,
    });
    const cards = await cardsOf(t);
    const pdfs = cards.filter((card) => card.type === "document");
    expect(pdfs).toHaveLength(8);
    expect(pdfs.filter((card) => card.aiOcrText)).toHaveLength(5);
    const shared = cards.filter((card) =>
      [card.aiOcrText, card.content].some((text) =>
        text?.toLowerCase().includes(OCR_LEASE_PHRASE)
      )
    );
    expect(shared.map((card) => card.type).sort()).toEqual([
      "document",
      "text",
    ]);
  });

  test("ocr-links seeds links read for text:, a blank render and a twin note", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "ocr-links")).toMatchObject({
      status: "seeded",
      cards: 7,
    });
    const cards = await cardsOf(t);
    const links = cards.filter(
      (card) =>
        card.type === "link" &&
        card.metadata?.linkPreview?.status === "success" &&
        card.metadataTitle !== "OCR links pack"
    );
    expect(links).toHaveLength(5);
    expect(links.filter((card) => card.aiOcrText)).toHaveLength(4);
    expect(
      cards.filter((card) =>
        [card.aiOcrText, card.content].some((text) =>
          text?.toLowerCase().includes("scaling postgres")
        )
      )
    ).toHaveLength(2);
  });

  test("done-states seeds every category, half done, and a to-do smart folder", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "done-states")).toMatchObject({
      status: "seeded",
      cards: 28,
      folders: 2,
    });
    const cards = (await cardsOf(t)).filter((card) =>
      card.tags?.includes("scenario-done-states")
    );
    const categories = new Set(
      cards.map((card) => card.metadata?.linkCategory?.category)
    );
    expect(categories).toEqual(new Set([...LINK_CATEGORIES, undefined]));
    expect(cards.filter((card) => card.completedAt)).toHaveLength(15);
    expect(cards.some((card) => card.completedAt && card.isDeleted)).toBe(true);
    expect(cards.some((card) => card.completedAt && card.isArchived)).toBe(
      true
    );
    expect(
      (await foldersOf(t)).find((folder) => folder.kind === "smart")?.query
    ).toBe('is:todo folder:"Reading list"');
  });

  test("rich-sites seeds links with their sites' details, once", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "rich-sites")).toMatchObject({
      status: "seeded",
      cards: 19,
    });
    expect(await seedFolders(t, "rich-sites")).toMatchObject({
      status: "already_seeded",
    });
    const cards = (await cardsOf(t)).filter((card) =>
      card.tags?.includes("scenario-rich-sites")
    );
    const byTitle = (title: string) =>
      cards.find((card) => card.metadataTitle === title)?.metadata
        ?.linkCategory;
    expect(byTitle("Mercury")?.facts).toContainEqual({
      label: "Page",
      value: "Disambiguation",
    });
    expect(byTitle("A paper with a PDF to save")).toMatchObject({
      category: "research",
      pdfUrl: "https://arxiv.org/pdf/1706.03762",
    });
    expect(byTitle("A withdrawn paper")).toMatchObject({
      category: "research",
    });
    expect(byTitle("A withdrawn paper")?.pdfUrl).toBeUndefined();
    expect(byTitle("A book with an ISBN-13")?.facts).toContainEqual({
      label: "Publisher",
      value: "Example Press",
    });
    expect(byTitle("A book whose ISBN check digit is wrong")?.facts).toEqual([
      { label: "ISBN", value: "9780140328722" },
    ]);
    expect(
      cards.every(
        (card) => (card.metadata?.linkCategory?.facts?.length ?? 0) <= 8
      )
    ).toBe(true);
  });

  test("video-captions seeds YouTube facts and Vimeo transcripts, once", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "video-captions")).toMatchObject({
      status: "seeded",
      cards: 10,
    });
    expect(await seedFolders(t, "video-captions")).toMatchObject({
      status: "already_seeded",
    });
    const cards = (await cardsOf(t)).filter((card) =>
      card.tags?.includes("scenario-video-captions")
    );
    const byTitle = (title: string) =>
      cards.find((card) => card.metadataTitle === title);
    expect(
      byTitle("A YouTube talk with channel, length and date")?.metadata
        ?.linkCategory?.facts
    ).toEqual([
      { label: "Channel", value: "Example Channel" },
      { label: "Length", value: "1h 2m 3s" },
      { label: "Uploaded", value: "Sep 14, 2026" },
    ]);
    expect(
      byTitle("A YouTube talk with channel, length and date")?.aiTranscript
    ).toBeUndefined();
    expect(byTitle("A two-hour Vimeo lecture")?.aiTranscript).toContain(
      "velvet harbor theorem"
    );
    expect(
      byTitle("A private Vimeo video with no captions")?.aiTranscript
    ).toBeUndefined();
  });

  test("podcast-transcripts seeds episodes with and without transcripts, once", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "podcast-transcripts")).toMatchObject({
      status: "seeded",
      cards: 8,
    });
    expect(await seedFolders(t, "podcast-transcripts")).toMatchObject({
      status: "already_seeded",
    });
    const cards = (await cardsOf(t)).filter((card) =>
      card.tags?.includes("scenario-podcast-transcripts")
    );
    const byTitle = (title: string) =>
      cards.find((card) => card.metadataTitle === title);
    expect(byTitle("Episode 42: Tide pools")).toMatchObject({
      aiTranscript: expect.stringContaining("hermit crab"),
      metadata: { linkCategory: { category: "podcast" } },
    });
    expect(
      byTitle("A Spotify episode (no public audio)")?.aiTranscript
    ).toBeUndefined();
    // Every episode is a podcast link, so processing would try it.
    expect(
      cards
        .filter(
          (card) =>
            card.type === "link" &&
            card.metadataTitle !== "Podcast transcripts pack"
        )
        .map((card) => card.metadata?.linkCategory?.category)
    ).toEqual(new Array(7).fill("podcast"));
    expect(byTitle("A transcribed episode in Trash")?.isDeleted).toBe(true);
    // The RSS-only episode's feed is where processing would look for it.
    const rssOnly = byTitle("An episode found through its show's RSS feed");
    expect(
      findFeedUrl(
        buildRawSelectorMap(rssOnly?.metadata?.linkPreview?.raw),
        rssOnly?.url ?? ""
      )
    ).toBe("https://shows.example.com/field-notes/feed.xml");
  });

  test("ai-languages seeds notes and links to process, once, and reports them", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    const args = { workosUserId: WORKOS_USER_ID, scenario: "ai-languages" };
    expect(await t.mutation(internal.devSeed.seedScenario, args)).toEqual({
      status: "seeded",
      cards: AI_LANGUAGE_CASES.length,
    });
    expect(await t.mutation(internal.devSeed.seedScenario, args)).toEqual({
      status: "already_seeded",
      cards: 0,
    });
    const cards = (await cardsOf(t)).filter((card) =>
      card.tags?.includes(AI_LANGUAGES_TAG)
    );
    expect(cards).toHaveLength(AI_LANGUAGE_CASES.length);
    // Every card waits for real AI processing, with no AI output yet.
    for (const card of cards) {
      expect(card.processingStatus?.metadata?.status).toBe("pending");
      expect(card.aiSummary).toBeUndefined();
      expect(card.aiLanguage).toBeUndefined();
    }
    expect(new Set(AI_LANGUAGE_CASES.map((entry) => entry.expected))).toEqual(
      new Set(["ja", "es", "de", "ko", "zh", "hi", "ar", "en", "fr", "pt"])
    );

    // Once processing has written a language, the report pairs it with
    // the language the card should have.
    const japanese = cards.find((card) => card.content.startsWith("来週"));
    await t.run((ctx) =>
      ctx.db.patch("cards", japanese?._id as Id<"cards">, {
        aiLanguage: "ja",
        aiSummary: "京都の町歩きの予定。",
      })
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const report: { label: string }[] = await t.query(
      internal.devSeed.aiLanguages.report,
      { workosUserId: WORKOS_USER_ID }
    );
    expect(report).toHaveLength(AI_LANGUAGE_CASES.length);
    expect(report.find((row) => row.label === "ja-kyoto")).toMatchObject({
      aiLanguage: "ja",
      aiSummary: "京都の町歩きの予定。",
      expected: "ja",
      type: "text",
    });
    expect(report.find((row) => row.label === "fr-eiffel")).toMatchObject({
      aiLanguage: null,
      expected: "fr",
      type: "link",
    });
  });

  test("locale-switch sets the account's language to German", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(
      await t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "locale-switch",
      })
    ).toEqual({ status: "seeded", cards: 0 });
    expect(
      await t.query(internal.settings.preferences.getPreferencesForUser, {
        userId: "teak_dev",
      })
    ).toEqual({ locale: "de" });
  });

  test("email-in seeds cards as Save by email makes them, and turns it on", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "email-in")).toMatchObject({
      status: "seeded",
      cards: 8,
    });
    expect(await seedFolders(t, "email-in")).toMatchObject({
      status: "already_seeded",
    });
    const cards = (await cardsOf(t)).filter(
      (card) =>
        card.tags?.includes("scenario-email-in") && card.tags.includes("email")
    );
    expect(cards).toHaveLength(7);
    for (const card of cards) {
      expect(card.metadata?.source).toBe("email");
    }
    const newsletter = cards.find((card) =>
      card.content.startsWith("# The Weekly Leaf")
    );
    expect(newsletter?.content).toContain("https://example.com/maples");
    expect(newsletter?.content).not.toContain("track.example.com");
    expect(newsletter?.content).not.toContain("utm_source");
    expect(cards.find((card) => card.type === "link")).toMatchObject({
      notes: "Worth a read:",
      url: "https://example.com/essays/slow-reading",
    });
    // As Save by email makes it: the page's own title comes from the scrape.
    expect(
      cards.find((card) => card.type === "link")?.metadataTitle
    ).toBeUndefined();
    const settings = await t.run((ctx) =>
      ctx.db.query("inboundEmailSettings").collect()
    );
    expect(settings).toEqual([
      expect.objectContaining({
        enabled: true,
        lastReceivedAt: expect.any(Number),
      }),
    ]);
  });

  test("email-attachments seeds a body note and its files as cards", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    expect(await seedFolders(t, "email-attachments")).toMatchObject({
      status: "seeded",
      cards: 9,
    });
    const cards = (await cardsOf(t)).filter((card) =>
      card.tags?.includes("scenario-email-attachments")
    );
    expect(
      cards
        .filter((card) => card.type === "document")
        .map((card) => card.fileMetadata?.fileName)
        .sort()
    ).toEqual(
      [
        "A 24 MB annual report.pdf",
        "Itinerary.pdf",
        "Notes from the workshop.docx",
        "Receipt.pdf",
        "Scan.pdf",
        "Scan.pdf",
        "請求書.pdf",
      ].sort()
    );
  });

  test("done-states-images seeds 1,000 images in pages, and nothing to do", async () => {
    vi.stubEnv("WORKOS_API_BASE_URL", "http://localhost:4100");
    const t = await setup();
    const seed = (page: number) =>
      t.mutation(internal.devSeed.seedScenario, {
        workosUserId: WORKOS_USER_ID,
        scenario: "done-states-images",
        page,
      });
    expect(await seed(0)).toEqual({ status: "seeded", cards: 201 });
    expect(await seed(0)).toEqual({ status: "already_seeded", cards: 0 });
    for (const page of [1, 2, 3, 4]) {
      expect(await seed(page)).toEqual({ status: "seeded", cards: 201 });
    }
    expect(await seed(5)).toEqual({ status: "already_seeded", cards: 0 });
    const cards = await t.run((ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_user_deleted_created", (q) => q.eq("userId", "teak_dev"))
        .collect()
    );
    expect(cards.filter((card) => card.type === "image")).toHaveLength(1000);
    expect(cards.filter((card) => card.metadata?.linkCategory)).toHaveLength(0);
  }, 60_000);

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
    const active = () =>
      t.run((ctx) =>
        ctx.db
          .query("cards")
          .withIndex("by_user_deleted_created", (q) =>
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
        .withIndex("by_user_deleted_created", (q) => q.eq("userId", "teak_dev"))
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
