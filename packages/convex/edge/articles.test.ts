import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { queuedObjectDeletions } from "../__tests__/helpers/objectDeletions.test-utils";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { initializeCardProcessingState } from "../card/processingLifecycle";
import {
  FILE_TEXT_SEARCH_LIMIT,
  searchCardsByDocument,
} from "../card/searchReads";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import { updateCardFieldForUserHandler } from "../card/updateCard";
import schema from "../schema";
import type { TeakUserId } from "../securitySessions";
import { articleImageObjectKey, articleTextObjectKey } from "../shared/article";
import { buildR2UserPrefix, cardStorageObjectKeys } from "../storage/r2";
import { queueCardProcessing } from "../workflowDispatch";

const modules = import.meta.glob("../**/*.ts");
const articleText = (internal as any)["card/articleText"];
const documentText = (internal as any)["card/documentText"];
const NOW = Date.UTC(2026, 9, 20, 10);
const HOUR = 60 * 60 * 1000;
const LINK = "https://example.com/gardens";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const ARTICLE = [
  "Gardens",
  "The marigold perimeter keeps aphids away from the tomatoes.",
  "Plant it in spring.",
].join("\n\n");

const digest = (fill: string) => fill.repeat(64);

const archiveOf = (capturedAt = NOW - HOUR) => ({
  bytes: 2048,
  capturedAt,
  kind: "full" as const,
  source: "server" as const,
  sourceUrl: LINK,
  storageKey: `${buildR2UserPrefix("owner")}/k/page-archive/r1-archive.html`,
});

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  const ownerWorkosId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: ownerWorkosId,
    sid: "session_owner",
    email_verified: true,
    external_id: "owner",
  });

  let createdAt = NOW - 10 * HOUR;
  const insert = (seed: Partial<Doc<"cards">> = {}) => {
    createdAt += 1;
    const at = createdAt;
    return t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId: "owner",
        type: "link",
        content: LINK,
        url: LINK,
        metadataStatus: "completed",
        metadata: {
          linkPreview: { status: "success", title: "Gardens", url: LINK },
        },
        pageArchive: archiveOf(),
        processingStatus: { article: { status: "pending" } },
        createdAt: at,
        updatedAt: at,
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });
  };
  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId)) as Promise<Doc<"cards">>;
  const rows = (cardId: Id<"cards">) =>
    t.run((ctx) =>
      ctx.db
        .query("cardTextContents")
        .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
        .collect()
    );
  const textKey = (cardId: Id<"cards">, fill = "a") =>
    articleTextObjectKey(buildR2UserPrefix("owner"), cardId, 1, digest(fill));
  const imageKey = (cardId: Id<"cards">, fill: string) =>
    articleImageObjectKey(buildR2UserPrefix("owner"), cardId, 1, digest(fill));
  const save = async (
    cardId: Id<"cards">,
    {
      fill = "a",
      images = ["b"],
      text = ARTICLE,
      wordCount = 640,
    }: {
      fill?: string;
      images?: string[];
      text?: string;
      wordCount?: number;
    } = {}
  ) =>
    await t.mutation(articleText.saveArticleText, {
      cardId,
      textKey: textKey(cardId, fill),
      searchText: text,
      charCount: text.length,
      truncated: false,
      article: {
        imageKeys: images.map((image) => imageKey(cardId, image)),
        wordCount,
        title: "Gardens",
        byline: "Ada",
        lang: "en",
      },
    });
  const search = async (searchQuery: string, types?: string[]) => {
    const result = await owner.query(api.cards.searchCardsPaginated, {
      searchQuery,
      paginationOpts: { numItems: 20, cursor: null },
      ...(types ? { types } : {}),
    });
    return result.page.map((item: { _id: string }) => item._id);
  };
  return {
    t,
    owner,
    insert,
    card,
    rows,
    textKey,
    imageKey,
    save,
    search,
    deletedKeys: () => queuedObjectDeletions(t),
  };
};

describe("saveArticleText", () => {
  test("writes the article row and the card's article, text key and counts", async () => {
    const { insert, save, card, rows, textKey, imageKey } = await setup();
    const link = await insert();

    expect(await save(link)).toBe(true);

    const stored = await card(link);
    expect(stored.article).toEqual({
      status: "ready",
      textKey: textKey(link),
      imageKeys: [imageKey(link, "b")],
      wordCount: 640,
      readingMinutes: 3,
      title: "Gardens",
      byline: "Ada",
      lang: "en",
      extractedAt: NOW,
    });
    expect(stored).toMatchObject({
      documentTextKey: textKey(link),
      hasExtractedText: true,
      extractedTextCharCount: ARTICLE.length,
      updatedAt: NOW,
    });
    expect(stored.processingStatus?.article?.status).toBe("completed");
    expect(await rows(link)).toEqual([
      expect.objectContaining({
        kind: "article",
        text: ARTICLE,
        sourceKey: textKey(link),
        charCount: ARTICLE.length,
        truncated: false,
      }),
    ]);
    // Every new object belongs to the card, so deleting it removes them.
    expect(cardStorageObjectKeys(stored)).toEqual(
      expect.arrayContaining([textKey(link), imageKey(link, "b")])
    );
  });

  test("saving the same article again keeps its objects; a new one queues only what it no longer uses", async () => {
    const { insert, save, rows, textKey, imageKey, deletedKeys } =
      await setup();
    const link = await insert();
    await save(link, { images: ["b", "c"] });
    await save(link, { images: ["b", "c"] });
    expect(await deletedKeys()).toEqual([]);
    expect(await rows(link)).toHaveLength(1);

    await save(link, { fill: "d", images: ["c", "e"] });

    expect((await deletedKeys()).sort()).toEqual(
      [textKey(link), imageKey(link, "b")].sort()
    );
    expect(await rows(link)).toHaveLength(1);
  });

  test("refuses objects outside the card's own article folders", async () => {
    const { t, insert, textKey } = await setup();
    const link = await insert();
    const other = await insert();
    const attempt = (key: string, imageKeys: string[] = []) =>
      t.mutation(articleText.saveArticleText, {
        cardId: link,
        textKey: key,
        searchText: ARTICLE,
        charCount: 10,
        truncated: false,
        article: { imageKeys, wordCount: 300 },
      });

    await expect(attempt(textKey(other))).rejects.toThrow(
      "outside the card's storage"
    );
    await expect(
      attempt(textKey(link), [`${buildR2UserPrefix("owner")}/x.webp`])
    ).rejects.toThrow("outside the card's storage");
    await expect(
      attempt(
        articleTextObjectKey(
          buildR2UserPrefix("stranger"),
          link,
          1,
          digest("a")
        )
      )
    ).rejects.toThrow("outside the card's storage");
  });

  test("an article for a card that is gone has its objects deleted", async () => {
    const { t, insert, textKey, imageKey, save, deletedKeys } = await setup();
    const link = await insert();
    await t.run((ctx) => ctx.db.delete("cards", link));

    expect(await save(link)).toBe(false);
    expect((await deletedKeys()).sort()).toEqual(
      [textKey(link), imageKey(link, "b")].sort()
    );
  });
});

describe("recordNoArticle", () => {
  test("a page that is no longer an article drops the old article and its objects", async () => {
    const { t, insert, save, card, rows, textKey, imageKey, deletedKeys } =
      await setup();
    const link = await insert();
    await save(link);

    await t.mutation(articleText.recordNoArticle, {
      cardId: link,
      wordCount: 40,
    });

    const stored = await card(link);
    expect(stored.article).toEqual({ status: "none", extractedAt: NOW });
    expect(stored.documentTextKey).toBeUndefined();
    expect(stored.hasExtractedText).toBeUndefined();
    expect(stored.processingStatus?.article?.status).toBe("completed");
    expect(await rows(link)).toEqual([]);
    expect((await deletedKeys()).sort()).toEqual(
      [textKey(link), imageKey(link, "b")].sort()
    );
  });
});

describe("saveArticleSummary", () => {
  test("writes only the summary, and only for a card with an article", async () => {
    const { t, insert, save, card } = await setup();
    const link = await insert({ aiSummary: "Old", aiTags: ["kept"] });
    const write = () =>
      t.mutation(articleText.saveArticleSummary, {
        cardId: link,
        aiSummary: "From the article",
      });

    expect(await write()).toBe(false);
    expect((await card(link)).aiSummary).toBe("Old");

    await save(link);
    expect(await write()).toBe(true);
    expect(await card(link)).toMatchObject({
      aiSummary: "From the article",
      aiTags: ["kept"],
    });
  });
});

describe("keyword search", () => {
  test("a phrase only in an article's body finds the link, with or without a type filter", async () => {
    const { t, insert, save, search } = await setup();
    const link = await insert();
    const document = await insert({
      type: "document",
      content: "",
      url: undefined,
      pageArchive: undefined,
    });
    await t.mutation(documentText.saveDocumentText, {
      cardId: document,
      key: `${buildR2UserPrefix("owner")}/${document}/document-text/${digest("f")}.txt`,
      text: "The marigold perimeter report for the allotment.",
      charCount: 48,
      truncated: false,
    });
    expect(await search('"marigold perimeter"')).toEqual([document]);

    await save(link);

    expect((await search('"marigold perimeter"')).sort()).toEqual(
      [document, link].sort()
    );
    expect(await search("aphids")).toEqual([link]);
    expect(await search("aphids", ["link"])).toEqual([link]);
    expect(await search("marigold", ["link"])).toEqual([link]);
    expect(await search("marigold", ["document"])).toEqual([document]);
    expect(await search("aphids", ["document"])).toEqual([]);
  });

  test("a link's article is found by type even when documents fill the text read", async () => {
    const { t, insert, save } = await setup();
    const document = await insert({
      type: "document",
      content: "",
      url: undefined,
      pageArchive: undefined,
    });
    for (let index = 0; index <= FILE_TEXT_SEARCH_LIMIT; index += 1) {
      await t.run((ctx) =>
        ctx.db.insert("cardTextContents", {
          cardId: document,
          userId: "owner",
          kind: "document",
          text: `marigold notes ${index}`,
          charCount: 20,
          truncated: false,
        })
      );
    }
    const link = await insert();
    await save(link);

    const found = await t.run((ctx) =>
      searchCardsByDocument(ctx, {
        userId: "owner",
        searchQuery: "marigold",
        type: "link",
        limit: 20,
      })
    );

    expect(found.map((card) => card._id)).toEqual([link]);
  });

  test("trashed and archived links follow the usual rules", async () => {
    const { t, owner, insert, save, search } = await setup();
    const kept = await insert();
    const trashed = await insert();
    const archived = await insert();
    for (const cardId of [kept, trashed, archived]) {
      await save(cardId);
    }
    await t.run(async (ctx) => {
      await ctx.db.patch("cards", trashed, { isDeleted: true });
      await ctx.db.patch("cards", archived, { isArchived: true });
    });

    expect(await search("aphids")).toEqual([kept]);
    const view = await owner.query(api.cards.searchCardsPaginated, {
      searchQuery: "aphids",
      paginationOpts: { numItems: 20, cursor: null },
      showTrashOnly: true,
    });
    expect(view.page.map((item: { _id: string }) => item._id)).toEqual([
      trashed,
    ]);
  });
});

describe("getCardTextSource", () => {
  test("an article only when asked for; without kind, the order is as before", async () => {
    const { t, insert, save, textKey, imageKey } = await setup();
    const link = await insert();
    await save(link);
    const source = (kind?: string, userId = "owner") =>
      t.query(documentText.getCardTextSource, {
        cardId: link,
        userId,
        ...(kind ? { kind } : {}),
      });

    expect(await source()).toBeNull();
    expect(await source("article")).toEqual({
      cardId: link,
      kind: "article",
      text: ARTICLE,
      sourceKey: textKey(link),
      imageKeys: [imageKey(link, "b")],
      charCount: ARTICLE.length,
      truncated: false,
    });
    expect(await source("article", "stranger")).toBeNull();
    expect(await source("document")).toBeNull();
    expect(await source("transcript")).toBeNull();

    // A podcast link with an article and a transcript: either, by kind.
    await t.mutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
      cardId: link,
      aiTranscript: "Welcome to the show",
    });
    expect(await source()).toMatchObject({
      kind: "transcript",
      text: "Welcome to the show",
    });
    expect(await source("transcript")).toMatchObject({ kind: "transcript" });
    expect(await source("article")).toMatchObject({ kind: "article" });
  });
});

describe("runs and stages", () => {
  test("an article-only run narrows only when the run it replaces did too", async () => {
    const { t, insert } = await setup();
    const full = await insert();
    const archive = await insert();
    const article = await insert();
    await t.run(async (ctx) => {
      await queueCardProcessing(ctx, full);
      await queueCardProcessing(ctx, full, { articleOnly: true });
      await queueCardProcessing(ctx, archive, { articleOnly: true });
      await queueCardProcessing(ctx, archive, { archiveOnly: true });
      await queueCardProcessing(ctx, article, { articleOnly: true });
      await queueCardProcessing(ctx, article, { articleOnly: true });
    });

    const claimed = await t.mutation(internal.workflowDispatch.claim, {});

    expect(
      claimed.map(
        ({ item }: { item: unknown }) => (item as { params: unknown }).params
      )
    ).toEqual([
      { cardId: full, rev: 2 },
      { archiveOnly: true, cardId: archive, rev: 2 },
      { articleOnly: true, cardId: article, rev: 2 },
    ]);
  });

  test("a failed run of a link with a copy but no article gets an article-only run, once", async () => {
    const { t, insert, card } = await setup();
    const link = await insert({
      processingStatus: {
        archive: { status: "completed" },
        article: { status: "pending" },
        metadata: { status: "in_progress" },
      },
    });
    const queued = await t.run((ctx) => queueCardProcessing(ctx, link));
    await t.mutation(internal.workflowDispatch.claim, {});
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: queued?.instanceId as string,
      status: "errored",
    });

    const runs = await t.run(async (ctx) =>
      (await ctx.db.query("workflowDispatches").collect()).filter(
        (row) => row.kind === "cardProcessing"
      )
    );
    expect(runs.map((row) => row.params)).toEqual([
      { cardId: link, rev: 1 },
      { articleOnly: true, cardId: link, rev: 2 },
    ]);
    expect((await card(link)).processingStatus?.article?.status).toBe(
      "pending"
    );

    await t.mutation(internal.workflowDispatch.claim, {});
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: runs[1]?.instanceId as string,
      status: "errored",
    });
    expect((await card(link)).processingStatus?.article).toMatchObject({
      error: "workflow_failed",
      status: "failed",
    });
  });

  test("Refresh details starts the article over; other resets keep it", async () => {
    const { t, insert, card } = await setup();
    const done = {
      article: { completedAt: NOW, status: "completed" as const },
    };
    const refreshed = await insert({ processingStatus: done });
    const edited = await insert({ processingStatus: done });

    await t.run(async (ctx) => {
      await initializeCardProcessingState(ctx, refreshed, { refresh: true });
      await initializeCardProcessingState(ctx, edited);
    });

    expect((await card(refreshed)).processingStatus?.article).toEqual({
      status: "pending",
    });
    expect((await card(edited)).processingStatus?.article).toEqual({
      completedAt: NOW,
      status: "completed",
    });
  });

  test("markArticleStage fails the stage, and closes it when there is nothing to read", async () => {
    const { t, insert, card } = await setup();
    const link = await insert();

    await t.mutation(articleText.markArticleStage, {
      cardId: link,
      status: "failed",
      reason: "archive_missing",
    });
    expect((await card(link)).processingStatus?.article).toMatchObject({
      error: "archive_missing",
      status: "failed",
    });

    await t.mutation(articleText.markArticleStage, {
      cardId: link,
      status: "completed",
    });
    expect((await card(link)).processingStatus?.article?.status).toBe(
      "completed"
    );
  });
});

describe("editing a link's URL", () => {
  test("drops the old page's article, its row and objects, and waits for the new one", async () => {
    const { t, insert, save, card, rows, textKey, imageKey, deletedKeys } =
      await setup();
    const link = await insert();
    await save(link);

    await t.run((ctx) =>
      updateCardFieldForUserHandler(ctx, {
        userId: "owner" as TeakUserId,
        cardId: link,
        field: "url",
        value: "https://example.com/other-page",
      })
    );

    const stored = await card(link);
    expect(stored.article).toBeUndefined();
    expect(stored.documentTextKey).toBeUndefined();
    expect(stored.hasExtractedText).toBeUndefined();
    expect(stored.processingStatus?.article).toEqual({ status: "pending" });
    expect(await rows(link)).toEqual([]);
    expect(await deletedKeys()).toEqual(
      expect.arrayContaining([textKey(link), imageKey(link, "b")])
    );
  });
});
