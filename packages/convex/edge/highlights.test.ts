import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { queuedObjectDeletions } from "../__tests__/helpers/objectDeletions.test-utils";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { accountDeletionStage } from "../accountDeletion/stages";
import { createCardForUserHandler } from "../card/createCard";
import { initializeCardProcessingState } from "../card/processingLifecycle";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import { updateCardFieldForUserHandler } from "../card/updateCard";
import { newImportFolderCache } from "../folder/folders";
import { insertImportedHighlights } from "../highlight/highlights";
import { createImportedCard } from "../import/items";
import schema from "../schema";
import type { TeakUserId } from "../securitySessions";
import { articleTextObjectKey } from "../shared/article";
import { anchorContext } from "../shared/highlights/anchor";
import { markdownToReaderText } from "../shared/highlights/readerText";
import {
  buildR2ObjectKey,
  buildR2UserPrefix,
  PENDING_UPLOAD_CARD_ID,
} from "../storage/r2";

const modules = import.meta.glob("../**/*.ts");
const articleText = (internal as any)["card/articleText"];
const NOW = Date.UTC(2026, 9, 20, 10);
const HOUR = 60 * 60 * 1000;
const LINK = "https://example.com/gardens";
const OWNER = "owner" as TeakUserId;

const ARTICLE = [
  "# Gardens",
  "",
  "Plant marigolds around the tomatoes. Water in the morning.",
  "",
  "In summer, water in the morning again. Mulch keeps the soil cool.",
].join("\n");
const TEXT = markdownToReaderText(ARTICLE, { title: "Gardens" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sha256 = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");

const archiveOf = (storage = "r1-archive.html") => ({
  bytes: 2048,
  capturedAt: NOW - 2 * HOUR,
  kind: "full" as const,
  source: "server" as const,
  sourceUrl: LINK,
  storageKey: `${buildR2UserPrefix("owner")}/k/page-archive/${storage}`,
});

/** Where `quote` (the n-th time it appears) is in the reader's text. */
const span = (quote: string, nth = 0) => {
  let start = -1;
  for (let seen = 0; seen <= nth; seen += 1) {
    start = TEXT.indexOf(quote, start + 1);
  }
  if (start < 0) {
    throw new Error(`not in the article: ${quote}`);
  }
  const end = start + quote.length;
  return { quote, start, end, ...anchorContext(TEXT, start, end) };
};

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const identity = async (userId: string) =>
    t.withIdentity({
      issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
      subject: await seedWorkosOwner(t, userId),
      sid: `session_${userId}`,
      email_verified: true,
      external_id: userId,
    });
  const owner = await identity("owner");
  const other = await identity("other");
  const textKey = async (cardId: Id<"cards">, markdown = ARTICLE, rev = 1) =>
    articleTextObjectKey(
      buildR2UserPrefix("owner"),
      cardId,
      rev,
      await sha256(markdown)
    );

  const link = async (seed: Partial<Doc<"cards">> = {}) => {
    const id = await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        type: "link",
        content: LINK,
        url: LINK,
        urlKey: "example.com/gardens",
        metadataStatus: "completed",
        metadataTitle: "Gardens",
        pageArchive: archiveOf(),
        processingStatus: {
          archive: { status: "completed" },
          article: { status: "completed" },
        },
        createdAt: NOW - HOUR,
        updatedAt: NOW - HOUR,
        ...seed,
      })
    );
    if (!("article" in seed)) {
      await t.run((ctx) =>
        ctx.db.patch("cards", id, {
          article: {
            status: "ready",
            textKey: "",
            imageKeys: [],
            wordCount: 30,
            readingMinutes: 1,
            title: "Gardens",
            extractedAt: NOW - HOUR,
          },
        })
      );
      const key = await textKey(id);
      await t.run(async (ctx) => {
        const card = (await ctx.db.get("cards", id)) as Doc<"cards">;
        if (card.article?.status === "ready") {
          await ctx.db.patch("cards", id, {
            article: { ...card.article, textKey: key },
          });
        }
        await syncCardSearchDocumentHandler(ctx, id);
      });
    }
    return id;
  };
  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId)) as Promise<Doc<"cards">>;
  const rows = (cardId?: Id<"cards">) =>
    t.run(async (ctx) =>
      (await ctx.db.query("highlights").collect()).filter(
        (row) => cardId === undefined || row.cardId === cardId
      )
    );
  const create = (
    cardId: Id<"cards">,
    quote: string,
    extra: { nth?: number; note?: string } = {}
  ) =>
    owner.mutation(api.highlight.highlights.create, {
      cardId,
      ...span(quote, extra.nth),
      ...(extra.note ? { note: extra.note } : {}),
    });
  return { t, owner, other, link, card, rows, create, textKey };
};

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as { data?: { code?: string } }).data?.code;
  }
  return "no error";
};

describe("making highlights", () => {
  test("a highlight keeps the card's count and flag in step and moves its updatedAt", async () => {
    const { link, card, create, owner } = await setup();
    const cardId = await link();

    const first = await create(cardId, "Water in the morning.");
    await create(cardId, "Plant marigolds");

    expect(first).toMatchObject({ created: true, merged: false });
    expect(first.highlight).toMatchObject({
      ...span("Water in the morning."),
      source: "reader",
    });
    expect(await card(cardId)).toMatchObject({
      hasHighlights: true,
      highlightCount: 2,
      updatedAt: NOW,
    });
    const listed = await owner.query(api.highlight.highlights.listForCard, {
      cardId,
    });
    expect(listed.map((row: { quote: string }) => row.quote)).toEqual([
      "Plant marigolds",
      "Water in the morning.",
    ]);
  });

  test("the same passage twice is one highlight", async () => {
    const { link, card, create, rows } = await setup();
    const cardId = await link();

    await create(cardId, "Plant marigolds");
    const again = await create(cardId, "Plant marigolds");

    expect(again).toMatchObject({ created: false, merged: false });
    expect(await rows(cardId)).toHaveLength(1);
    expect((await card(cardId)).highlightCount).toBe(1);
  });

  test("overlapping highlights merge into one spanning all of them, keeping the oldest note", async () => {
    const { link, card, create, rows } = await setup();
    const cardId = await link();
    await create(cardId, "Plant marigolds", { note: "Oldest" });
    vi.setSystemTime(NOW + 1);
    await create(cardId, "the tomatoes.", { note: "Newer" });
    vi.setSystemTime(NOW + 2);

    const merged = await create(cardId, "marigolds around the tomatoes");

    expect(merged.merged).toBe(true);
    const stored = await rows(cardId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      ...span("Plant marigolds around the tomatoes."),
      note: "Oldest",
      createdAt: NOW,
    });
    expect((await card(cardId)).highlightCount).toBe(1);
  });

  test.each([
    ["an empty quote", { quote: "  ", start: 0, end: 2 }, "INVALID_INPUT"],
    [
      "offsets that don't match the quote",
      { quote: "Plant", start: 0, end: 9 },
      "INVALID_INPUT",
    ],
    [
      "a quote past 5,000 characters",
      { quote: "x".repeat(5001), start: 0, end: 5001 },
      "INVALID_INPUT",
    ],
  ])("refuses %s", async (_name, args, code) => {
    const { link, owner } = await setup();
    const cardId = await link();
    expect(
      await codeOf(
        owner.mutation(api.highlight.highlights.create, { cardId, ...args })
      )
    ).toBe(code);
  });

  test("refuses a note past 2,000 characters", async () => {
    const { link, create } = await setup();
    const cardId = await link();
    expect(
      await codeOf(create(cardId, "Plant", { note: "n".repeat(2001) }))
    ).toBe("INVALID_INPUT");
  });

  test("a card holds 200 highlights; an overlapping one still merges at the cap", async () => {
    const { t, link, create, card } = await setup();
    const cardId = await link();
    const quote = span("Mulch keeps");
    await t.run(async (ctx) => {
      for (let index = 0; index < 199; index += 1) {
        await ctx.db.insert("highlights", {
          userId: "owner",
          cardId,
          quote: "Waiting",
          unanchored: true,
          source: "import",
          createdAt: index,
          updatedAt: index,
        });
      }
      await ctx.db.patch("cards", cardId, {
        hasHighlights: true,
        highlightCount: 199,
      });
    });
    await create(cardId, "Mulch keeps");

    expect(await codeOf(create(cardId, "Plant marigolds"))).toBe(
      "HIGHLIGHT_LIMIT"
    );
    const merged = await create(cardId, "Mulch keeps the soil");
    expect(merged.highlight).toMatchObject({
      start: quote.start,
      quote: "Mulch keeps the soil",
    });
    expect((await card(cardId)).highlightCount).toBe(200);
  });

  test.each([
    ["no article", { article: undefined }],
    [
      "a page that isn't an article",
      { article: { status: "none", extractedAt: 1 } },
    ],
    ["a card in Trash", { isDeleted: true, deletedAt: NOW }],
  ] as const)("refuses %s with NO_ARTICLE", async (_name, fields) => {
    const { t, link, create } = await setup();
    const cardId = await link();
    await t.run((ctx) =>
      ctx.db.patch("cards", cardId, fields as Partial<Doc<"cards">>)
    );
    expect(await codeOf(create(cardId, "Plant"))).toBe("NO_ARTICLE");
  });

  test("another account can't list, make, note or remove them", async () => {
    const { link, create, other, rows } = await setup();
    const cardId = await link();
    const { highlight } = await create(cardId, "Plant marigolds");

    expect(
      await other.query(api.highlight.highlights.listForCard, { cardId })
    ).toEqual([]);
    expect(
      await codeOf(
        other.mutation(api.highlight.highlights.create, {
          cardId,
          ...span("Mulch"),
        })
      )
    ).toBe("NOT_FOUND");
    expect(
      await codeOf(
        other.mutation(api.highlight.highlights.updateNote, {
          highlightId: highlight._id,
          note: "mine",
        })
      )
    ).toBe("NOT_FOUND");
    expect(
      await codeOf(
        other.mutation(api.highlight.highlights.remove, {
          highlightId: highlight._id,
        })
      )
    ).toBe("NOT_FOUND");
    expect(await rows(cardId)).toHaveLength(1);
  });
});

describe("notes and removal", () => {
  test("a note is written, then cleared with null, moving the card's updatedAt", async () => {
    const { link, create, owner, card } = await setup();
    const cardId = await link();
    const { highlight } = await create(cardId, "Plant marigolds");
    vi.setSystemTime(NOW + 5000);

    const noted = await owner.mutation(api.highlight.highlights.updateNote, {
      highlightId: highlight._id,
      note: "  In spring  ",
    });
    expect(noted.note).toBe("In spring");
    expect((await card(cardId)).updatedAt).toBe(NOW + 5000);

    const cleared = await owner.mutation(api.highlight.highlights.updateNote, {
      highlightId: highlight._id,
      note: null,
    });
    expect(cleared.note).toBeUndefined();
  });

  test("removing the last highlight clears the card's flag and count", async () => {
    const { link, create, owner, card } = await setup();
    const cardId = await link();
    const first = await create(cardId, "Plant marigolds");
    const second = await create(cardId, "Mulch keeps");

    await owner.mutation(api.highlight.highlights.remove, {
      highlightId: first.highlight._id,
    });
    expect((await card(cardId)).highlightCount).toBe(1);
    await owner.mutation(api.highlight.highlights.remove, {
      highlightId: second.highlight._id,
    });
    const stored = await card(cardId);
    expect(stored.hasHighlights).toBeUndefined();
    expect(stored.highlightCount).toBeUndefined();
  });

  test("past 120 writes a minute the next is RATE_LIMITED", async () => {
    const { link, create, owner } = await setup();
    const cardId = await link();
    const { highlight } = await create(cardId, "Plant marigolds");
    for (let index = 0; index < 119; index += 1) {
      await owner.mutation(api.highlight.highlights.updateNote, {
        highlightId: highlight._id,
        note: `note ${index}`,
      });
    }
    expect(
      await codeOf(
        owner.mutation(api.highlight.highlights.updateNote, {
          highlightId: highlight._id,
          note: "one too many",
        })
      )
    ).toBe("RATE_LIMITED");
  });
});

describe("imported highlights", () => {
  test("wait unanchored, then are found once the article is saved", async () => {
    const { t, link, rows, card, textKey } = await setup();
    const cardId = await link({ article: undefined, pageArchive: undefined });
    await t.run(async (ctx) => {
      await insertImportedHighlights(ctx, { _id: cardId, userId: "owner" }, [
        { quote: "water in the\nmorning again", note: "Imported note" },
        { quote: "Never in the article" },
        { quote: "WATER IN THE MORNING AGAIN. Mulch" },
      ]);
    });
    expect(await card(cardId)).toMatchObject({
      hasHighlights: true,
      highlightCount: 3,
    });
    expect((await rows(cardId)).every((row) => row.unanchored)).toBe(true);

    const key = await textKey(cardId);
    await t.mutation(articleText.saveArticleText, {
      cardId,
      textKey: key,
      searchText: TEXT,
      charCount: TEXT.length,
      truncated: false,
      article: { imageKeys: [], wordCount: 30, title: "Gardens" },
    });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    expect(scheduled.map((job) => job.name)).toContain(
      "highlight/anchorPending:anchorPendingHighlights"
    );

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        expect(new URL(url).pathname).toBe(`/${key}`);
        return Promise.resolve(new Response(ARTICLE));
      })
    );
    const placed = await t.action(
      internal.highlight.anchorPending.anchorPendingHighlights,
      { cardId }
    );

    // The first and third overlap, so they are one highlight now.
    expect(placed).toBe(2);
    const stored = await rows(cardId);
    expect(stored).toHaveLength(2);
    const found = stored.find((row) => !row.unanchored);
    const expected = span("water in the morning again. Mulch");
    expect(found).toMatchObject({
      start: expected.start,
      end: expected.end,
      quote: TEXT.slice(expected.start, expected.end),
      note: "Imported note",
      articleKey: key,
    });
    expect(stored.find((row) => row.unanchored)?.quote).toBe(
      "Never in the article"
    );
    expect((await card(cardId)).highlightCount).toBe(2);
  });
});

describe("importing", () => {
  test("an imported link brings its highlights, unanchored, and a failed one none", async () => {
    const { t, rows, card } = await setup();
    const job = {
      _id: "job_1",
      mode: "instapaper",
      userId: "owner",
    } as unknown as Doc<"importJobs">;
    const outcome = await t.run((ctx) =>
      createImportedCard(
        ctx,
        job,
        OWNER,
        {
          type: "link",
          content: "Gardens",
          url: "https://example.com/imported",
          highlights: [{ quote: "Plant marigolds", note: "Spring" }],
        } as never,
        newImportFolderCache()
      )
    );
    expect(outcome.kind).toBe("created");
    const cardId = (outcome as { cardId: Id<"cards"> }).cardId;
    expect(await rows(cardId)).toMatchObject([
      {
        quote: "Plant marigolds",
        note: "Spring",
        unanchored: true,
        source: "import",
        userId: "owner",
      },
    ]);
    expect(await card(cardId)).toMatchObject({
      hasHighlights: true,
      highlightCount: 1,
    });
  });
});

describe("a highlighted link is frozen", () => {
  test("Refresh details keeps its copy's and article's stages", async () => {
    const { t, link, create, card } = await setup();
    const cardId = await link();
    await create(cardId, "Plant marigolds");

    await t.run((ctx) =>
      initializeCardProcessingState(ctx, cardId, { refresh: true })
    );

    expect((await card(cardId)).processingStatus).toMatchObject({
      archive: { status: "completed" },
      article: { status: "completed" },
    });
  });

  test("a new article for it is refused and its objects deleted", async () => {
    const { t, link, create, card, textKey } = await setup();
    const cardId = await link();
    await create(cardId, "Plant marigolds");
    const before = await card(cardId);
    const newKey = await textKey(cardId, "Another article", 2);

    const saved = await t.mutation(articleText.saveArticleText, {
      cardId,
      textKey: newKey,
      searchText: "Another article",
      charCount: 15,
      truncated: false,
      article: { imageKeys: [], wordCount: 2 },
    });
    await t.mutation(articleText.recordNoArticle, { cardId, wordCount: 2 });

    expect(saved).toBe(false);
    expect((await card(cardId)).article).toEqual(before.article);
    expect(await queuedObjectDeletions(t)).toContain(newKey);
  });

  test("a new copy for it is refused and deleted", async () => {
    const { t, link, create, card } = await setup();
    const cardId = await link();
    await create(cardId, "Plant marigolds");
    const fresh = archiveOf("r9-archive.html");

    const recorded = await t.mutation(
      internal.workflows.steps.archive.mutations.recordPageArchive,
      { cardId, archive: fresh }
    );

    expect(recorded).toBe(false);
    expect((await card(cardId)).pageArchive).toEqual(archiveOf());
    expect(await queuedObjectDeletions(t)).toContain(fresh.storageKey);
  });

  test("saving it again with the page from the extension drops that page", async () => {
    const { t, link, create, card } = await setup();
    const cardId = await link();
    await create(cardId, "Plant marigolds");
    const snapshot = buildR2ObjectKey({
      userId: "owner",
      cardId: PENDING_UPLOAD_CARD_ID,
      role: "page-snapshot",
      objectId: "s1",
    });
    await t.run((ctx) =>
      ctx.db.insert("accountStorageObjects", { key: snapshot, userId: "owner" })
    );

    const result = await t.run((ctx) =>
      createCardForUserHandler(
        ctx,
        OWNER,
        { content: LINK, pageSnapshotKey: snapshot },
        { source: "api" }
      )
    );

    expect(result).toMatchObject({ cardId, outcome: "resaved" });
    const stored = await card(cardId);
    expect(stored.pendingPageSnapshotKey).toBeUndefined();
    expect(stored.pageArchive).toEqual(archiveOf());
    expect(await queuedObjectDeletions(t)).toContain(snapshot);
  });

  test("its URL can't change until the highlights are removed", async () => {
    const { t, link, create, card, owner } = await setup();
    const cardId = await link();
    const { highlight } = await create(cardId, "Plant marigolds");
    const edit = () =>
      t.run((ctx) =>
        updateCardFieldForUserHandler(ctx, {
          userId: OWNER,
          cardId,
          field: "url",
          value: "https://example.com/other",
        })
      );

    expect(await codeOf(edit())).toBe("CONFLICT");
    expect((await card(cardId)).url).toBe(LINK);

    await owner.mutation(api.highlight.highlights.remove, {
      highlightId: highlight._id,
    });
    await edit();
    expect((await card(cardId)).url).toBe("https://example.com/other");
  });
});

describe("deleting", () => {
  test("deleting a card forever removes its highlights", async () => {
    const { t, link, create, rows } = await setup();
    const cardId = await link();
    const kept = await link({ url: "https://example.com/kept" });
    await create(cardId, "Plant marigolds");
    await create(kept, "Plant marigolds");

    await t.run((ctx) =>
      ctx.db.patch("cards", cardId, { isDeleted: true, deletedAt: 1 })
    );
    await t.mutation(internal["card/deleteCard"].permanentDeleteCardForUser, {
      cardId,
      userId: "owner",
    });

    expect((await rows()).map((row) => row.cardId)).toEqual([kept]);
  });

  test("deleting an account pages through every highlight", async () => {
    const { t, link, rows } = await setup();
    const cardId = await link();
    const strangers = await link({ userId: "stranger" });
    await t.run(async (ctx) => {
      for (let index = 0; index < 250; index += 1) {
        await ctx.db.insert("highlights", {
          userId: "owner",
          cardId,
          quote: `q${index}`,
          unanchored: true,
          source: "import",
          createdAt: index,
          updatedAt: index,
        });
      }
      await ctx.db.insert("highlights", {
        userId: "stranger",
        cardId: strangers,
        quote: "theirs",
        unanchored: true,
        source: "import",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const workosUserId = await t.run(
      async (ctx) =>
        (await ctx.db.query("users").collect()).find(
          (user) => user.teakUserId === "owner"
        )?.workosUserId
    );
    const stateId = await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: "owner",
        ...(workosUserId ? { workosUserId } : {}),
        startedAt: 1,
        generation: 1,
        stage: accountDeletionStage("accountData"),
      })
    );

    let pages = 0;
    while (
      await t.mutation(internal.accountDeletionData.ancillaryPage, {
        stateId,
        generation: 1,
      })
    ) {
      pages += 1;
      expect(pages).toBeLessThan(10);
    }

    expect(pages).toBe(3);
    expect((await rows()).map((row) => row.userId)).toEqual(["stranger"]);
  });
});
