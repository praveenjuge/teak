import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import schema from "../schema";
import {
  SEMANTIC_CACHE_TTL_MS,
  semanticSearchKey,
} from "../search/semanticCache";

const modules = import.meta.glob("../**/*.ts");
const STRONG = 0.45;
const WEAK = 0.2;

const stubVectorQuery = (
  answer: { matches: { id: string; score: number }[] } | "fail"
) => {
  const texts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://files.test") {
        throw new Error(`unexpected_fetch:${url}`);
      }
      const body = JSON.parse(String(init?.body));
      if (body.op !== "vector-query") {
        throw new Error(`unexpected_op:${body.op}`);
      }
      texts.push(body.params.text);
      const response =
        answer === "fail"
          ? Response.json(
              {
                ok: false,
                error: { code: "INTERNAL", message: "boom", requestId: "r" },
              },
              { status: 500 }
            )
          : Response.json({
              ok: true,
              version: 1,
              requestId: "r",
              data: answer,
            });
      return Promise.resolve(response);
    })
  );
  return texts;
};

type CardSeed = Partial<
  Pick<
    Doc<"cards">,
    | "content"
    | "isArchived"
    | "isDeleted"
    | "isFavorited"
    | "tags"
    | "type"
    | "userId"
  >
>;

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  const workosUserId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_hybrid",
    email_verified: true,
    external_id: "owner",
  });
  await t.run((ctx) =>
    ctx.db.insert("vectorShards", { userId: "owner", shard: 0 })
  );
  let nextCreatedAt = 1000;
  const insert = (seed: CardSeed) => {
    nextCreatedAt += 1;
    const createdAt = nextCreatedAt;
    return t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content: "",
        createdAt,
        updatedAt: createdAt,
        ...(seed.isDeleted ? { deletedAt: createdAt } : {}),
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });
  };
  const cache = async (
    text: string,
    matches: { id: Id<"cards"> | string; score: number }[],
    userId = "owner"
  ) =>
    t.mutation(internal.search.semanticCache.storeRanking, {
      userId,
      key: await semanticSearchKey(text),
      matches,
    });
  const grid = async (args: Record<string, unknown>, numItems = 2) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let index = 0; index < 50; index += 1) {
      const page: {
        continueCursor: string | null;
        isDone: boolean;
        page: { _id: string }[];
      } = await owner.query(api.cards.searchCardsPaginated, {
        ...args,
        paginationOpts: { numItems, cursor },
      });
      ids.push(...page.page.map((card: { _id: string }) => card._id));
      if (page.isDone) {
        return ids;
      }
      cursor = page.continueCursor;
    }
    throw new Error("Paging did not finish");
  };
  return { t, owner, insert, cache, grid };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "hybrid-test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const seedLibrary = async (env: Awaited<ReturnType<typeof setup>>) => {
  const keyword = await env.insert({ content: "Reading nook ideas" });
  const armchair = await env.insert({
    content: "Armchair by a window with books",
  });
  const weak = await env.insert({ content: "Parking ticket" });
  const trashed = await env.insert({
    content: "Window seat with cushions",
    isDeleted: true,
  });
  const archived = await env.insert({
    content: "Library ladder",
    isArchived: true,
  });
  const image = await env.insert({ content: "Sunny corner", type: "image" });
  const stranger = await env.insert({
    content: "Their reading corner",
    userId: "stranger",
  });
  const cardIds = {
    keyword,
    armchair,
    weak,
    trashed,
    archived,
    image,
    stranger,
  };
  await env.cache("reading nook", [
    { id: armchair, score: STRONG },
    { id: trashed, score: STRONG },
    { id: archived, score: STRONG },
    { id: image, score: STRONG },
    { id: stranger, score: STRONG },
    { id: weak, score: WEAK },
  ]);
  return cardIds;
};

describe("hybrid search in the grid", () => {
  test("marks the cards it matched by meaning", async () => {
    const env = await setup();
    const cards = await seedLibrary(env);
    const page = await env.owner.query(api.cards.searchCardsPaginated, {
      searchQuery: "reading nook",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(
      page.page.map((card: { _id: string; matchedByMeaning?: true }) => [
        card._id,
        card.matchedByMeaning ?? false,
      ])
    ).toEqual([
      [cards.image, true],
      [cards.armchair, true],
      [cards.keyword, false],
    ]);
  });

  test("merges strong meaning matches with keyword matches, newest first", async () => {
    const env = await setup();
    const cards = await seedLibrary(env);
    expect(await env.grid({ searchQuery: "reading nook" })).toEqual([
      cards.image,
      cards.armchair,
      cards.keyword,
    ]);
    expect(
      await env.grid({ searchQuery: "Reading   NOOK", sort: "oldest" })
    ).toEqual([cards.keyword, cards.armchair, cards.image]);
    const shuffled = await env.grid({
      searchQuery: "reading nook",
      sort: "shuffle",
      shuffleSeed: 7,
    });
    expect([...shuffled].sort()).toEqual(
      [cards.image, cards.armchair, cards.keyword].sort()
    );
    expect(
      await env.grid({
        searchQuery: "reading nook",
        sort: "shuffle",
        shuffleSeed: 7,
      })
    ).toEqual(shuffled);
  });

  test("is keyword-only until the meaning matches are cached", async () => {
    const env = await setup();
    const keyword = await env.insert({ content: "Reading nook ideas" });
    await env.insert({ content: "Armchair by a window with books" });
    expect(await env.grid({ searchQuery: "reading nook" })).toEqual([keyword]);
  });

  test("applies the view's filters to meaning matches", async () => {
    const env = await setup();
    const cards = await seedLibrary(env);
    expect(
      await env.grid({ searchQuery: "reading nook", showTrashOnly: true })
    ).toEqual([cards.trashed]);
    expect(
      await env.grid({ searchQuery: "reading nook", showArchivedOnly: true })
    ).toEqual([cards.archived]);
    expect(
      await env.grid({ searchQuery: "reading nook", types: ["image"] })
    ).toEqual([cards.image]);
    expect(await env.grid({ searchQuery: "reading nook type:text" })).toEqual([
      cards.armchair,
      cards.keyword,
    ]);
    expect(await env.grid({ searchQuery: "reading nook is:fav" })).toEqual([]);
    expect(await env.grid({ searchQuery: 'reading nook "window"' })).toEqual([
      cards.armchair,
    ]);
  });

  test("exclusions and OR groups filter meaning matches too", async () => {
    const env = await setup();
    const cards = await seedLibrary(env);
    expect(await env.grid({ searchQuery: "reading nook -window" })).toEqual([
      cards.image,
      cards.keyword,
    ]);
    expect(
      await env.grid({ searchQuery: "reading nook -window", mode: "semantic" })
    ).toEqual([cards.image]);
    expect(
      await env.grid({ searchQuery: "reading nook (type:image OR is:fav)" })
    ).toEqual([cards.image]);
  });

  test("an exclusion reads a meaning match's document text", async () => {
    const env = await setup();
    const cards = await seedLibrary(env);
    const pdf = await env.insert({ content: "Cosy corner plans" });
    await env.t.run(async (ctx) => {
      await ctx.db.patch("cards", pdf, { hasExtractedText: true });
      const document = await ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (q) => q.eq("cardId", pdf))
        .unique();
      if (!document) {
        throw new Error("missing search document");
      }
      await ctx.db.patch("cardSearchDocuments", document._id, {
        searchableText: `${document.searchableText}\nconfidential floor plan`,
      });
    });
    await env.cache("reading nook", [
      { id: cards.armchair, score: STRONG },
      { id: pdf, score: STRONG },
    ]);
    expect(
      await env.grid({ searchQuery: "reading nook", mode: "semantic" })
    ).toEqual([pdf, cards.armchair]);
    expect(
      await env.grid({
        searchQuery: "reading nook -confidential",
        mode: "semantic",
      })
    ).toEqual([cards.armchair]);
  });

  test("keyword mode gives keyword results and semantic mode meaning ones", async () => {
    const env = await setup();
    const cards = await seedLibrary(env);
    expect(
      await env.grid({ searchQuery: "reading nook", mode: "keyword" })
    ).toEqual([cards.keyword]);
    expect(
      await env.grid({ searchQuery: "reading nook", mode: "semantic" })
    ).toEqual([cards.image, cards.armchair]);
  });

  test("a weak meaning match counts when the words match too", async () => {
    const env = await setup();
    const keyword = await env.insert({ content: "Reading nook ideas" });
    await env.cache("reading nook", [{ id: keyword, score: WEAK }]);
    expect(await env.grid({ searchQuery: "reading nook" })).toEqual([keyword]);
    expect(
      await env.grid({ searchQuery: "reading nook", mode: "semantic" })
    ).toEqual([]);
  });

  test("a tag: search lists a card with the tag and the word as a word match", async () => {
    const env = await setup();
    const bauhaus = await env.insert({
      content: "Bauhaus - Wikipedia",
      tags: ["design"],
    });
    const poster = await env.insert({
      content: "Modernist poster layouts",
      tags: ["design"],
    });
    const untagged = await env.insert({ content: "Bauhaus chair" });
    await env.cache("bauhaus", [
      { id: bauhaus, score: STRONG },
      { id: poster, score: STRONG },
      { id: untagged, score: STRONG },
    ]);
    const marks = async (searchQuery: string) =>
      (
        await env.owner.query(api.cards.searchCardsPaginated, {
          searchQuery,
          paginationOpts: { numItems: 10, cursor: null },
        })
      ).page.map((card: { _id: string; matchedByMeaning?: true }) => [
        card._id,
        card.matchedByMeaning ?? false,
      ]);
    expect(await marks("bauhaus")).toEqual([
      [untagged, false],
      [poster, true],
      [bauhaus, false],
    ]);
    expect(await marks("tag:design bauhaus")).toEqual([
      [poster, true],
      [bauhaus, false],
    ]);
    expect(await marks("tag:design bauhaus is:fav")).toEqual([]);
  });

  test("a word match with only some of the words stays marked by meaning", async () => {
    const env = await setup();
    const partial = await env.insert({ content: "verify capx checklist" });
    const full = await env.insert({ content: "verify navx checklist" });
    await env.cache("verify navx", [
      { id: partial, score: STRONG },
      { id: full, score: STRONG },
    ]);
    const marks = async (args: Record<string, unknown>) =>
      Object.fromEntries(
        (
          await env.owner.query(api.cards.searchCardsPaginated, {
            searchQuery: "verify navx",
            paginationOpts: { numItems: 10, cursor: null },
            ...args,
          })
        ).page.map((card: { _id: string; matchedByMeaning?: true }) => [
          card._id,
          card.matchedByMeaning ?? false,
        ])
      );
    // The newest-first sort reads search documents; the best-match sort with
    // stored relevance scores loads every card.
    for (const args of [{}, { sort: "relevance", useRelevanceScores: true }]) {
      expect(await marks(args)).toEqual({ [partial]: true, [full]: false });
    }
  });

  test("another user's cached matches never reach this user's search", async () => {
    const env = await setup();
    const theirs = await env.insert({
      content: "Armchair by a window",
      userId: "stranger",
    });
    await env.cache("reading nook", [{ id: theirs, score: 0.9 }], "stranger");
    expect(await env.grid({ searchQuery: "reading nook" })).toEqual([]);
  });

  test("mobile summaries merge the same matches", async () => {
    const env = await setup();
    const cards = await seedLibrary(env);
    const page = await env.owner.query(
      api.card.mobileCardSummaries.searchMobileCardSummariesPaginated,
      {
        searchQuery: "reading nook",
        paginationOpts: { numItems: 10, cursor: null },
      }
    );
    expect(page.page.map((card: { _id: string }) => card._id)).toEqual([
      cards.image,
      cards.armchair,
      cards.keyword,
    ]);
  });
});

describe("hybrid search with price:", () => {
  const seedLamps = async (env: Awaited<ReturnType<typeof setup>>) => {
    const product = (content: string, price?: number) =>
      env.t.run(async (ctx) => {
        const url = `https://shop.example/${content.replace(/\s+/g, "-")}`;
        const id = await ctx.db.insert("cards", {
          userId: "owner",
          type: "link",
          content,
          url,
          metadata: {
            linkCategory: {
              category: "product",
              fetchedAt: 1,
              sourceUrl: url,
              ...(price === undefined ? {} : { price: { amount: price } }),
            },
          },
          createdAt: 2000 + (price ?? 0),
          updatedAt: 2000,
        });
        await syncCardSearchDocumentHandler(ctx, id);
        return id;
      });
    const cheap = await product("Brass task light", 40);
    const pricey = await product("Designer task light", 400);
    const unpriced = await product("Task light kit");
    const keyword = await product("Desk lamp clamp", 25);
    const note = await env.insert({ content: "Light for my desk" });
    const ranking = await env.cache("desk lamp", [
      { id: cheap, score: STRONG },
      { id: pricey, score: STRONG },
      { id: unpriced, score: STRONG },
      { id: note, score: STRONG },
    ]);
    return { cheap, pricey, unpriced, keyword, note, ranking };
  };

  test("embeds only the words, and drops meaning matches outside the bound", async () => {
    const env = await setup();
    const lamps = await seedLamps(env);
    expect(await env.grid({ searchQuery: "desk lamp price:<100" })).toEqual([
      lamps.cheap,
      lamps.keyword,
    ]);
    expect(
      await env.grid({ searchQuery: "desk lamp price:<100", mode: "semantic" })
    ).toEqual([lamps.cheap]);
    expect(await env.grid({ searchQuery: "desk lamp price:>100" })).toEqual([
      lamps.pricey,
    ]);
  });

  test("the API drops meaning matches outside the bound", async () => {
    const env = await setup();
    const lamps = await seedLamps(env);
    const page = await env.t.query(internal.publicApi.searchCardsPageForUser, {
      userId: "owner",
      searchQuery: "desk lamp",
      type: "link",
      prices: [{ op: "<", amount: 100 }],
      semanticRanking: lamps.ranking,
      limit: 10,
    });
    expect(page.items.map((card: { _id: string }) => card._id)).toEqual([
      lamps.cheap,
      lamps.keyword,
    ]);
  });
});

describe("hybrid search in the API", () => {
  const pageArgs = (
    semanticRanking: { cardId: Id<"cards">; score: number }[] | undefined,
    extra: Record<string, unknown> = {}
  ) => ({
    userId: "owner",
    searchQuery: "reading nook",
    limit: 1,
    ...(semanticRanking ? { semanticRanking } : {}),
    ...extra,
  });

  const readAll = async (
    t: Awaited<ReturnType<typeof setup>>["t"],
    args: Record<string, unknown>
  ) => {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let index = 0; index < 20; index += 1) {
      const page = await t.query(internal.publicApi.searchCardsPageForUser, {
        ...(args as ReturnType<typeof pageArgs>),
        cursor,
      });
      ids.push(...page.items.map((card: { _id: string }) => card._id));
      if (!page.pageInfo.nextCursor) {
        return ids;
      }
      cursor = page.pageInfo.nextCursor;
    }
    throw new Error("Paging did not finish");
  };

  test("pages a fused set with match cursors, without repeats", async () => {
    const env = await setup();
    const cards = await seedLibrary(env);
    const ranking = await env.cache("reading nook", [
      { id: cards.armchair, score: STRONG },
      { id: cards.weak, score: WEAK },
      { id: cards.stranger, score: STRONG },
      { id: cards.trashed, score: STRONG },
    ]);
    expect(await readAll(env.t, pageArgs(ranking))).toEqual([
      cards.armchair,
      cards.keyword,
    ]);
    expect(
      await readAll(env.t, pageArgs(ranking, { mode: "keyword" }))
    ).toEqual([cards.keyword]);
    expect(
      await readAll(env.t, pageArgs(ranking, { mode: "semantic" }))
    ).toEqual([cards.armchair]);
    expect(await readAll(env.t, pageArgs(undefined))).toEqual([cards.keyword]);
    expect(
      await readAll(env.t, pageArgs(ranking, { showTrashOnly: true }))
    ).toEqual([cards.trashed]);
  });

  test("shuffles a fused set", async () => {
    const env = await setup();
    const cards = await seedLibrary(env);
    const ranking = await env.cache("reading nook", [
      { id: cards.armchair, score: STRONG },
    ]);
    const page = await env.t.query(internal.publicApi.shuffleCardsPageForUser, {
      ...pageArgs(ranking),
      limit: 10,
      shuffleSeed: 3,
    });
    expect(page.items.map((card: { _id: string }) => card._id).sort()).toEqual(
      [cards.armchair, cards.keyword].sort()
    );
  });
});

describe("requestSemanticResults", () => {
  test("caches the matches the grid then merges, and reuses them", async () => {
    const env = await setup();
    const keyword = await env.insert({ content: "Reading nook ideas" });
    const armchair = await env.insert({
      content: "Armchair by a window with books",
    });
    const texts = stubVectorQuery({
      matches: [
        { id: armchair, score: STRONG },
        { id: "not-a-card-id", score: STRONG },
      ],
    });
    expect(
      await env.owner.action(
        api.search.semanticActions.requestSemanticResults,
        {
          searchQuery: "Reading nook tag:home",
        }
      )
    ).toEqual({ outcome: "ok" });
    expect(texts).toEqual(["reading nook"]);
    const rows = await env.t.run((ctx) =>
      ctx.db.query("semanticSearchResults").collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ranking).toEqual([{ cardId: armchair, score: STRONG }]);
    expect(JSON.stringify(rows)).not.toContain("reading");

    expect(await env.grid({ searchQuery: "reading nook" })).toEqual([
      armchair,
      keyword,
    ]);
    await env.owner.action(api.search.semanticActions.requestSemanticResults, {
      searchQuery: "reading nook",
    });
    expect(texts).toHaveLength(1);
  });

  test("embeds a smart folder's words with the typed ones", async () => {
    const env = await setup();
    const armchair = await env.insert({ content: "Armchair by a window" });
    const folderId = await env.t.run((ctx) =>
      ctx.db.insert("folders", {
        userId: "owner",
        name: "Cozy",
        nameKey: "cozy",
        kind: "smart",
        query: "cozy type:text",
        activeCardCount: 0,
        createdAt: 1,
        updatedAt: 1,
      })
    );
    const texts = stubVectorQuery({
      matches: [{ id: armchair, score: STRONG }],
    });
    await env.owner.action(api.search.semanticActions.requestSemanticResults, {
      searchQuery: "reading nook",
      folderId,
    });
    expect(texts).toEqual(["cozy reading nook"]);
    expect(await env.grid({ searchQuery: "reading nook", folderId })).toEqual([
      armchair,
    ]);
  });

  test("makes no call for a search without free words", async () => {
    const env = await setup();
    const texts = stubVectorQuery({ matches: [] });
    expect(
      await env.owner.action(
        api.search.semanticActions.requestSemanticResults,
        {
          searchQuery: "tag:design type:link #fff",
        }
      )
    ).toEqual({ outcome: "skipped" });
    expect(texts).toEqual([]);
  });

  test("leaves search keyword-only when the vector service fails", async () => {
    const env = await setup();
    const keyword = await env.insert({ content: "Reading nook ideas" });
    stubVectorQuery("fail");
    expect(
      await env.owner.action(
        api.search.semanticActions.requestSemanticResults,
        {
          searchQuery: "reading nook",
        }
      )
    ).toEqual({ outcome: "unavailable" });
    expect(
      await env.t.run((ctx) => ctx.db.query("semanticSearchResults").collect())
    ).toEqual([]);
    expect(await env.grid({ searchQuery: "reading nook" })).toEqual([keyword]);
  });

  test("stops calling the vector service past the rate limit", async () => {
    const env = await setup();
    const texts = stubVectorQuery({ matches: [] });
    const outcomes: string[] = [];
    for (let index = 0; index < 61; index += 1) {
      const { outcome } = await env.owner.action(
        api.search.semanticActions.requestSemanticResults,
        { searchQuery: `search number ${index}` }
      );
      outcomes.push(outcome);
    }
    expect(outcomes.slice(0, 60).every((outcome) => outcome === "ok")).toBe(
      true
    );
    expect(outcomes[60]).toBe("rate_limited");
    expect(texts).toHaveLength(60);
  });

  test("returns nothing for a signed-out caller", async () => {
    const env = await setup();
    const texts = stubVectorQuery({ matches: [] });
    expect(
      await env.t.action(api.search.semanticActions.requestSemanticResults, {
        searchQuery: "reading nook",
      })
    ).toEqual({ outcome: "skipped" });
    expect(texts).toEqual([]);
  });
});

test("cleanup removes only expired cache entries", async () => {
  const env = await setup();
  await env.cache("old search", []);
  vi.advanceTimersByTime(SEMANTIC_CACHE_TTL_MS + 1);
  await env.cache("new search", []);
  expect(
    await env.t.mutation(internal.search.semanticCache.cleanupExpired, {})
  ).toEqual({ deleted: 1, hasMore: false });
  const rows = await env.t.run((ctx) =>
    ctx.db.query("semanticSearchResults").collect()
  );
  expect(rows.map((row) => row.key)).toEqual([
    await semanticSearchKey("new search"),
  ]);
});
