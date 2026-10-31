import rateLimiterTest from "@convex-dev/rate-limiter/test";
import counterTest from "@convex-dev/sharded-counter/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { createCardForUserHandler } from "../card/createCard";
import {
  type DevScenarioCardDef,
  insertCompletedCards,
} from "../card/defaultCards";
import { serializeCard } from "../export/serialize";
import { normalizeIndexItem } from "../import/indexItems";
import schema from "../schema";
import type { TeakUserId } from "../securitySessions";
import { FREE_TIER_LIMIT } from "../shared/constants";

const modules = import.meta.glob("../**/*.ts");

const SAVED = "https://www.example.com/post/";
const VARIANT = "http://example.com/post?utm_source=newsletter#top";
const FIRST_SAVED = Date.UTC(2026, 0, 1);
const NOW = Date.UTC(2026, 9, 20);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  apiKeysTest.register(t);
  counterTest.register(t, "apiKeys/shardedCounter");
  const workosUserId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_owner",
    email_verified: true,
    external_id: "owner",
  });
  /** Cards saved earlier, as they'd be months before the re-save. */
  const seed = (cards: DevScenarioCardDef[]) =>
    t.run((ctx) =>
      insertCompletedCards(ctx, "owner", cards, { ignoreCardLimit: true })
    );
  const seedLink = async (fields: Partial<DevScenarioCardDef> = {}) => {
    const [id] = await seed([
      {
        type: "link",
        content: SAVED,
        url: SAVED,
        createdAt: FIRST_SAVED,
        ...fields,
      },
    ]);
    return id;
  };
  const save = (args: {
    content: string;
    notes?: string;
    tags?: string[];
    type?: "text" | "link";
    url?: string;
  }) =>
    owner.mutation(api.card.createCard.createCardWithOutcome, {
      ...args,
      source: "web",
    });
  const get = (id: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", id)) as Promise<Doc<"cards">>;
  const liveCards = () =>
    t.run((ctx) =>
      ctx.db
        .query("cards")
        .withIndex("by_user_deleted_created", (q) =>
          q.eq("userId", "owner").eq("isDeleted", undefined)
        )
        .collect()
    );
  const dispatches = (kind: string) =>
    t.run(async (ctx) =>
      (await ctx.db.query("workflowDispatches").collect()).filter(
        (row) => row.kind === kind
      )
    );
  return { t, owner, seed, seedLink, save, get, liveCards, dispatches };
};

describe("saving a link that's already in Teak", () => {
  test("moves that card to the top instead of making a second one", async () => {
    const { seedLink, save, get, liveCards, owner } = await setup();
    const id = await seedLink();

    expect(await save({ content: VARIANT })).toEqual({
      cardId: id,
      outcome: "resaved",
    });

    const card = await get(id);
    expect(card.savedAt).toBe(NOW);
    expect(card.updatedAt).toBe(NOW);
    expect(card.createdAt).toBe(FIRST_SAVED);
    expect(card.url).toBe(SAVED);
    expect(await liveCards()).toHaveLength(1);
    // The native apps' mutation still answers with the id alone.
    expect(
      await owner.mutation(api.card.createCard.createCard, { content: SAVED })
    ).toBe(id);
  });

  test("brings an archived card back from Archive", async () => {
    const { seedLink, save, get } = await setup();
    const id = await seedLink({ isArchived: true });

    expect(await save({ content: SAVED, url: SAVED, type: "link" })).toEqual({
      cardId: id,
      outcome: "resaved",
      wasArchived: true,
    });
    const card = await get(id);
    expect(card.isArchived).toBeUndefined();
    expect(card.archivedAt).toBeUndefined();
    expect(card.savedAt).toBe(NOW);
  });

  test("makes a new card when the only match is in Trash", async () => {
    const { seedLink, save, liveCards } = await setup();
    const trashed = await seedLink({ isDeleted: true });

    const result = await save({ content: SAVED });
    expect(result.outcome).toBe("created");
    expect(result.cardId).not.toBe(trashed);
    expect((await liveCards()).map((card) => card._id)).toEqual([
      result.cardId,
    ]);
  });

  test.each([
    ["the link with words around it", { content: `Read this: ${SAVED}` }],
    [
      "a URL field with a different note as its content",
      { content: "Worth a second look", url: SAVED },
    ],
    ["a text note that is the link", { content: SAVED, type: "text" as const }],
  ])("makes a new card for %s", async (_label, args) => {
    const { seedLink, save, get, liveCards } = await setup();
    const id = await seedLink();

    expect((await save(args)).outcome).toBe("created");
    expect(await liveCards()).toHaveLength(2);
    expect((await get(id)).savedAt).toBe(FIRST_SAVED);
  });

  test("ignores the tags and notes sent with a re-save", async () => {
    const { seedLink, save, get } = await setup();
    const id = await seedLink({ tags: ["kept"], notes: "First note" });

    expect(
      await save({ content: SAVED, notes: "Second note", tags: ["new"] })
    ).toMatchObject({ cardId: id, outcome: "resaved" });
    const card = await get(id);
    expect(card.notes).toBe("First note");
    expect(card.tags).toEqual(["kept"]);
  });

  test("works for a free account at the card limit, which can't add a new link", async () => {
    const { seed, seedLink, save, liveCards } = await setup();
    const id = await seedLink();
    await seed(
      Array.from({ length: FREE_TIER_LIMIT - 1 }, (_, index) => ({
        type: "text" as const,
        content: `Filler ${index}`,
        createdAt: FIRST_SAVED + index,
      }))
    );
    // Seeding counts the cards; the account itself is free.
    await expect(
      save({ content: "https://example.com/not-saved-yet" })
    ).rejects.toMatchObject({
      data: expect.objectContaining({ code: "CARD_LIMIT_REACHED" }),
    });

    expect(await save({ content: VARIANT })).toEqual({
      cardId: id,
      outcome: "resaved",
    });
    expect(await liveCards()).toHaveLength(FREE_TIER_LIMIT);
  });

  test("spends a card creation token, like a new card", async () => {
    const { seedLink, save } = await setup();
    await seedLink();

    let saved = 0;
    let limited = false;
    for (let attempt = 0; attempt < 40 && !limited; attempt += 1) {
      try {
        expect((await save({ content: SAVED })).outcome).toBe("resaved");
        saved += 1;
      } catch (error) {
        expect(error).toMatchObject({
          data: expect.objectContaining({ code: "RATE_LIMITED" }),
        });
        limited = true;
      }
    }
    expect(limited).toBe(true);
    expect(saved).toBeLessThanOrEqual(30);
  });

  test("moves the card's folder and tag rows too, and doesn't process it again", async () => {
    const { t, owner, save, dispatches } = await setup();
    const { _id: folderId } = await owner.mutation(api.folders.createFolder, {
      name: "Reading",
    });
    const id = await owner.mutation(api.card.createCard.createCard, {
      content: SAVED,
      tags: ["reading"],
    });
    await owner.mutation(api.folder.membership.addCardsToFolder, {
      folderId,
      cardIds: [id],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const later = NOW + 86_400_000;
    vi.setSystemTime(later);

    expect(await save({ content: VARIANT })).toMatchObject({
      outcome: "resaved",
    });
    const queuedAfter = (await dispatches("cardProcessing")).filter(
      (row) => row.createdAt >= later
    );
    expect(queuedAfter).toEqual([]);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run(async (ctx) => ({
      folder: await ctx.db
        .query("folderCards")
        .withIndex("by_cardId_and_folderId", (q) => q.eq("cardId", id))
        .collect(),
      tags: await ctx.db
        .query("cardSearchTags")
        .withIndex("by_cardId_and_tag", (q) => q.eq("cardId", id))
        .collect(),
      document: await ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (q) => q.eq("cardId", id))
        .unique(),
    }));
    expect(rows.folder.map((row) => row.cardSavedAt)).toEqual([later]);
    expect(rows.tags.map((row) => row.cardSavedAt)).toEqual([later]);
    expect(rows.document?.cardSavedAt).toBe(later);
  });

  test("two saves of one new link at once make one card", async () => {
    const { save, liveCards } = await setup();
    const results = await Promise.all([
      save({ content: SAVED }),
      save({ content: VARIANT }),
    ]);

    expect(
      results.map((result: { outcome: string }) => result.outcome).sort()
    ).toEqual(["created", "resaved"]);
    expect(results[0].cardId).toBe(results[1].cardId);
    expect(await liveCards()).toHaveLength(1);
  });

  test("reports card_resaved, not card_created", async () => {
    vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
    vi.stubEnv("FILES_BASE", "https://files.test");
    vi.stubEnv("FILES_SIGNING_SECRET", "test-files-secret");
    const { seedLink, save, dispatches } = await setup();
    await seedLink({ isArchived: true });

    await save({ content: SAVED });
    const events = (await dispatches("analyticsEvent")).map(
      (row) => row.params as { event: string; properties: unknown }
    );
    expect(events.map((event) => event.event)).toEqual(["card_resaved"]);
    expect(events[0].properties).toMatchObject({
      source: "web",
      was_archived: true,
    });
  });
});

describe("imports", () => {
  test("never move a card already in Teak", async () => {
    const { t, seedLink, get, liveCards } = await setup();
    const id = await seedLink({ isArchived: true });
    const jobId = await t.run((ctx) =>
      ctx.db.insert("importJobs", {
        userId: "owner",
        mode: "archive",
        status: "importing",
        phase: "Importing",
        fileName: "teak-export.zip",
        fileSize: 128,
        fileLastModified: 0,
        sourceKey: "users/owner/imports/job/source.zip",
        parsedCount: 0,
        processedCount: 0,
        createdCount: 0,
        skippedCount: 0,
        failedCount: 0,
        createdAt: 0,
        updatedAt: 0,
      })
    );
    await t.mutation(internal.dataImport.insertItems, {
      jobId,
      items: [
        {
          sourceIndex: 0,
          status: "pending",
          type: "link",
          content: VARIANT,
          url: VARIANT,
          importedCreatedAt: NOW - 1000,
          importedSavedAt: NOW - 500,
        },
      ],
    });
    const itemIds = await t.run(async (ctx) =>
      (await ctx.db.query("importJobItems").collect()).map((item) => item._id)
    );
    await t.mutation(internal.dataImport.createPendingBatch, {
      jobId,
      itemIds,
    });

    const card = await get(id);
    expect(card.savedAt).toBe(FIRST_SAVED);
    expect(card.isArchived).toBe(true);
    expect(await liveCards()).toHaveLength(1);
    const [item] = await t.run((ctx) =>
      ctx.db.query("importJobItems").collect()
    );
    expect(item.failureCode).toBe("DUPLICATE_URL");
  });

  test("insert even past the rule when they ask to", async () => {
    const { t, seedLink, liveCards } = await setup();
    await seedLink();
    const result = await t.run((ctx) =>
      createCardForUserHandler(
        ctx,
        "owner" as TeakUserId,
        { content: SAVED, url: SAVED },
        { skipResave: true, source: "import" }
      )
    );
    expect(result.outcome).toBe("created");
    expect(await liveCards()).toHaveLength(2);
  });

  test("a Teak archive keeps when a card was saved again, and older archives fall back to createdAt", async () => {
    const source = await setup();
    const id = await source.seedLink();
    await source.save({ content: VARIANT });
    const exported = JSON.parse(
      JSON.stringify([
        serializeCard(await source.get(id)),
        {
          ...serializeCard({
            ...(await source.get(id)),
            _id: "older",
            url: "https://example.com/older",
          }),
          savedAt: undefined,
        },
      ])
    ) as unknown[];

    const { t, liveCards } = await setup();
    const items = exported.map((raw, index) =>
      normalizeIndexItem(raw, index, new Map(), new Set())
    );
    const jobId = await t.run((ctx) =>
      ctx.db.insert("importJobs", {
        userId: "owner",
        mode: "archive",
        status: "importing",
        phase: "Importing",
        fileName: "teak-export.zip",
        fileSize: 128,
        fileLastModified: 0,
        sourceKey: "users/owner/imports/job/source.zip",
        parsedCount: 0,
        processedCount: 0,
        createdCount: 0,
        skippedCount: 0,
        failedCount: 0,
        createdAt: 0,
        updatedAt: 0,
      })
    );
    await t.mutation(internal.dataImport.insertItems, {
      jobId,
      items: items.map((item) => {
        if (item.status !== "pending") {
          throw new Error(`Item not importable: ${item.status}`);
        }
        return item;
      }),
    });
    const itemIds = await t.run(async (ctx) =>
      (await ctx.db.query("importJobItems").collect()).map((item) => item._id)
    );
    await t.mutation(internal.dataImport.createPendingBatch, {
      jobId,
      itemIds,
    });

    const byUrl = new Map(
      (await liveCards()).map((card) => [card.url, card] as const)
    );
    expect(byUrl.get(SAVED)).toMatchObject({
      createdAt: FIRST_SAVED,
      savedAt: NOW,
    });
    expect(byUrl.get("https://example.com/older")).toMatchObject({
      createdAt: FIRST_SAVED,
      savedAt: FIRST_SAVED,
    });
  });
});

describe("the public API", () => {
  test("quick save says resaved, and wasArchived when it was archived", async () => {
    const { t, seedLink } = await setup();
    const id = await seedLink({ isArchived: true });

    const result = await t.mutation(
      internal.publicApi.cardsForUser.quickSaveForUser,
      { userId: "owner", url: VARIANT, notes: "ignored" }
    );
    expect(result).toMatchObject({
      status: "created",
      cardId: id,
      resaved: true,
      wasArchived: true,
    });
    expect(result.card?.savedAt).toBe(NOW);
    expect(result.card?.notes).toBeUndefined();
  });

  test("bulk create re-saves a known link and the same link twice in one request", async () => {
    const { t, seedLink, liveCards } = await setup();
    const known = await seedLink();

    const result = await t.mutation(
      internal.publicApi.executeBulkCardsForUser,
      {
        userId: "owner",
        operation: "create",
        items: [
          { url: VARIANT },
          { url: "https://example.com/new" },
          { url: "https://www.example.com/new/" },
        ],
      }
    );
    const [first, second, third] = result.results as {
      cardId: string;
      resaved?: true;
      status: string;
    }[];
    expect(first).toEqual({
      index: 0,
      status: "success",
      cardId: known,
      resaved: true,
    });
    expect(second).toEqual({
      index: 1,
      status: "success",
      cardId: second.cardId,
    });
    expect(third).toEqual({
      index: 2,
      status: "success",
      cardId: second.cardId,
      resaved: true,
    });
    expect(result.summary).toEqual({ total: 3, succeeded: 3, failed: 0 });
    expect(await liveCards()).toHaveLength(2);
  });

  test("POST /v1/cards answers resaved with the card, and a replay returns the first answer", async () => {
    const { t, owner, seedLink, get } = await setup();
    const id = await seedLink({ isArchived: true });
    const key = await owner.mutation(api.apiKeys.createUserApiKey, {
      name: "Re-save",
    });
    const post = () =>
      t.fetch("/v1/cards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key.key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "resave-1",
        },
        body: JSON.stringify({ url: VARIANT, tags: ["ignored"] }),
      });

    const response = await post();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "created",
      cardId: id,
      resaved: true,
      wasArchived: true,
      card: {
        id,
        createdAt: FIRST_SAVED,
        savedAt: NOW,
        isArchived: false,
        tags: [],
      },
    });

    vi.setSystemTime(NOW + 60_000);
    const replay = await post();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(body);
    expect((await get(id)).savedAt).toBe(NOW);
  });
});
