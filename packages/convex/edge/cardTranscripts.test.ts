import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  deleteAccountDataHandler,
  type OwnedCardIds,
} from "../accountDeletion";
import { initializeCardProcessingState } from "../card/processingLifecycle";
import type { CardWithUrls } from "../card/queryUtils";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import { withTranscripts } from "../card/textContents";
import schema from "../schema";
import { semanticSearchKey } from "../search/semanticCache";

const modules = import.meta.glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// Long enough to be stored in more than one part (32 KB each).
const LONG_TRANSCRIPT = `The hermit crab moved house at dawn. ${"Waves rolled over the reef. ".repeat(1500)}The end.`;

type CardSeed = Partial<Omit<Doc<"cards">, "_id" | "_creationTime">>;

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  const workosUserId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_transcripts",
    email_verified: true,
    external_id: "owner",
  });

  // A card as the app saves it: the search sync runs after the write.
  const save = (seed: CardSeed = {}) =>
    t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId: "owner",
        type: "audio",
        content: "",
        createdAt: 1000,
        updatedAt: 1000,
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });
  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId));
  const transcriptRows = (cardId: Id<"cards">) =>
    t.run((ctx) =>
      ctx.db
        .query("cardTextContents")
        .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
        .collect()
    );
  const searchText = (cardId: Id<"cards">) =>
    t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("cardSearchDocuments")
            .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
            .unique()
        )?.searchableText
    );
  const saveTranscript = (cardId: Id<"cards">, aiTranscript: string) =>
    t.mutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
      cardId,
      aiTags: ["ocean"],
      aiTranscript,
    });
  const detail = (id: Id<"cards">) => owner.query(api.cards.getCard, { id });
  const grid = async (
    args: Record<string, unknown> = {}
  ): Promise<CardWithUrls[]> =>
    (
      await owner.query(api.cards.searchCardsPaginated, {
        paginationOpts: { numItems: 50, cursor: null },
        ...args,
      })
    ).page;
  const cardsMissingAi = async () =>
    (await t.query(internal.ai.queries.findCardsMissingAi, {})).map(
      ({ cardId }: { cardId: Id<"cards"> }) => cardId
    );

  return {
    t,
    owner,
    save,
    card,
    transcriptRows,
    searchText,
    saveTranscript,
    detail,
    grid,
    cardsMissingAi,
  };
};

describe("a transcript lives in cardTextContents, not on the card", () => {
  test("the Worker's transcript is stored in parts; the card keeps its length and a preview", async () => {
    const { save, saveTranscript, card, transcriptRows } = await setup();
    const cardId = await save();

    expect(await saveTranscript(cardId, LONG_TRANSCRIPT)).toBe(true);

    expect(await card(cardId)).toMatchObject({
      aiTranscriptCharCount: LONG_TRANSCRIPT.length,
      aiTranscriptPreview: LONG_TRANSCRIPT.slice(0, 280),
      aiTags: ["ocean"],
    });
    expect((await card(cardId))?.aiTranscript).toBeUndefined();
    const rows = await transcriptRows(cardId);
    expect(rows.length).toBeGreaterThan(1);
    expect(
      rows
        .sort((a, b) => (a.part ?? 0) - (b.part ?? 0))
        .map((row) => row.text)
        .join("")
    ).toBe(LONG_TRANSCRIPT);
  });

  test("the card's detail returns the whole transcript; lists leave it out", async () => {
    const { save, saveTranscript, detail, grid, owner } = await setup();
    const cardId = await save();
    await saveTranscript(cardId, LONG_TRANSCRIPT);

    expect((await detail(cardId))?.aiTranscript).toBe(LONG_TRANSCRIPT);
    const listed = (await grid()).find((item) => item._id === cardId);
    expect(listed).toMatchObject({
      aiTranscriptCharCount: LONG_TRANSCRIPT.length,
    });
    expect(listed).not.toHaveProperty("aiTranscript");
    const all = await owner.query(api.cards.getCards, {});
    expect(
      all.find((item: CardWithUrls) => item._id === cardId)
    ).not.toHaveProperty("aiTranscript");
  });

  test("lists leave image text out but say the card has it; its detail keeps it", async () => {
    const { save, detail, grid } = await setup();
    const cardId = await save({ type: "image", aiOcrText: "INVOICE 4411" });

    const listed = (await grid()).find((item) => item._id === cardId);
    expect(listed).not.toHaveProperty("aiOcrText");
    expect(listed?.hasOcrText).toBe(true);
    expect((await detail(cardId))?.aiOcrText).toBe("INVOICE 4411");
  });

  test("search still finds words from a transcript and from image text", async () => {
    const { save, saveTranscript, grid } = await setup();
    const audio = await save();
    await saveTranscript(audio, LONG_TRANSCRIPT);
    const image = await save({ type: "image", aiOcrText: "INVOICE 4411" });

    expect(
      (await grid({ searchQuery: "hermit" })).map((item) => item._id)
    ).toEqual([audio]);
    // Filtered to audio, only the card's search text holds the transcript.
    expect(
      (await grid({ searchQuery: "hermit", types: ["audio"] })).map(
        (item) => item._id
      )
    ).toEqual([audio]);
    expect(
      (await grid({ searchQuery: "invoice" })).map((item) => item._id)
    ).toEqual([image]);
  });

  test("phrases and words found only in a moved transcript still match meaning and similar searches", async () => {
    vi.stubEnv("FILES_BASE", "https://files.test");
    vi.stubEnv("FILES_SIGNING_SECRET", "transcripts-test-secret");
    try {
      const { t, save, saveTranscript, grid } = await setup();
      await t.run((ctx) =>
        ctx.db.insert("vectorShards", { userId: "owner", shard: 0 })
      );
      const anchor = await save({ type: "text", content: "Tide pools" });
      const audio = await save();
      await saveTranscript(audio, LONG_TRANSCRIPT);
      const other = await save({ type: "text", content: "Rock pools" });
      const cache = async (text: string, ids: Id<"cards">[]) =>
        t.mutation(internal.search.semanticCache.storeRanking, {
          userId: "owner",
          key: await semanticSearchKey(text),
          matches: ids.map((id) => ({ id, score: 0.9 })),
        });
      await cache("hermit crab", [audio, other]);
      await cache(`like\n${anchor}`, [anchor, audio, other]);
      const ids = async (args: Record<string, unknown>) =>
        (await grid(args)).map((item) => item._id);

      expect(
        await ids({ searchQuery: '"hermit crab"', mode: "semantic" })
      ).toEqual([audio]);
      expect(await ids({ searchQuery: `like:${anchor} hermit` })).toEqual([
        audio,
      ]);
      expect(
        await ids({ searchQuery: `like:${anchor} "hermit crab"` })
      ).toEqual([audio]);

      const ranking = [audio, other].map((cardId) => ({ cardId, score: 0.9 }));
      const api = (args: Record<string, unknown>) =>
        t.query(internal.publicApi.searchCardsPageForUser, {
          userId: "owner",
          limit: 10,
          ...args,
        });
      const viaApi = await api({
        searchQuery: "hermit crab",
        phrases: ["hermit crab"],
        semanticRanking: ranking,
        mode: "semantic",
      });
      expect(viaApi.items.map((card: { _id: string }) => card._id)).toEqual([
        audio,
      ]);
      const similarViaApi = await api({
        searchQuery: "hermit",
        similarity: { kind: "like", cardId: anchor },
        semanticRanking: [{ cardId: anchor, score: 1 }, ...ranking],
      });
      expect(
        similarViaApi.items.map((card: { _id: string }) => card._id)
      ).toEqual([audio]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("public API lists put transcripts back when asked", async () => {
    const { t, save, saveTranscript } = await setup();
    const cardId = await save();
    await saveTranscript(cardId, LONG_TRANSCRIPT);
    const { items } = await t.query(internal.publicApi.scanCardsPageForUser, {
      userId: "owner",
      scanLimit: 50,
    });
    expect(items[0]).not.toHaveProperty("aiTranscript");

    const hydrated = await withTranscripts(
      { runQuery: t.query as ActionCtx["runQuery"] },
      "owner",
      items
    );
    expect(hydrated[0]?.aiTranscript).toBe(LONG_TRANSCRIPT);
    expect(
      await withTranscripts(
        { runQuery: t.query as ActionCtx["runQuery"] },
        "stranger",
        items
      )
    ).toEqual(items);
  });

  test("a new transcript replaces the old parts, and reprocessing clears them", async () => {
    const { t, save, saveTranscript, card, transcriptRows, detail } =
      await setup();
    const cardId = await save();
    await saveTranscript(cardId, LONG_TRANSCRIPT);
    await saveTranscript(cardId, "A short take.");

    expect((await transcriptRows(cardId)).map((row) => row.text)).toEqual([
      "A short take.",
    ]);
    expect((await detail(cardId))?.aiTranscript).toBe("A short take.");

    await t.run((ctx) => initializeCardProcessingState(ctx, cardId));
    expect(await transcriptRows(cardId)).toEqual([]);
    expect((await card(cardId))?.aiTranscriptCharCount).toBeUndefined();
    expect((await detail(cardId))?.aiTranscript).toBeUndefined();
  });

  test("deleting the card or the account removes its transcript rows", async () => {
    const { t, owner, save, saveTranscript, transcriptRows } = await setup();
    const deleted = await save();
    await saveTranscript(deleted, LONG_TRANSCRIPT);
    const accountCard = await save();
    await saveTranscript(accountCard, LONG_TRANSCRIPT);

    await owner.mutation(api.cards.permanentDeleteCard, { id: deleted });
    expect(await transcriptRows(deleted)).toEqual([]);

    await t.run((ctx) =>
      deleteAccountDataHandler(ctx, [accountCard] as OwnedCardIds)
    );
    expect(await transcriptRows(accountCard)).toEqual([]);
  });
});

describe("the AI backfill reads aiPending", () => {
  test("a card saved without AI is pending until its AI is saved", async () => {
    const { save, saveTranscript, card, cardsMissingAi } = await setup();
    const waiting = await save({ type: "text", content: "A note" });
    const done = await save({ type: "text", content: "Tagged", aiTags: ["x"] });

    expect((await card(waiting))?.aiPending).toBe(true);
    expect((await card(done))?.aiPending).toBeUndefined();
    expect(await cardsMissingAi()).toEqual([waiting]);

    await saveTranscript(waiting, "Now it has a transcript.");
    expect((await card(waiting))?.aiPending).toBeUndefined();
    expect(await cardsMissingAi()).toEqual([]);
  });

  test("the AI backfill takes at most 50 cards, deleted flag unset or false", async () => {
    const { save, cardsMissingAi } = await setup();
    const unset = await save({ type: "text", content: "Unset" });
    const notDeleted = await save({
      type: "text",
      content: "False",
      isDeleted: false,
    });
    await save({ type: "text", content: "Trashed", isDeleted: true });
    expect(new Set(await cardsMissingAi())).toEqual(
      new Set([unset, notDeleted])
    );

    for (let index = 0; index < 60; index++) {
      await save({ type: "text", content: `Note ${index}` });
    }
    expect(await cardsMissingAi()).toHaveLength(50);
  });
});
