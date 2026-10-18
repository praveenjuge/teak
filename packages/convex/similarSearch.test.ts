import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { syncCardSearchDocumentHandler } from "./card/searchDocumentHelpers";
import schema from "./schema";
import { semanticSearchKey } from "./search/semanticCache";

const modules = import.meta.glob("./**/*.ts");

interface WorkerCall {
  op: string;
  params: Record<string, any>;
}

const stubWorker = (answers: {
  similar?: { found: boolean; matches: { id: string; score: number }[] };
  query?: { matches: { id: string; score: number }[] };
}) => {
  const calls: WorkerCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://files.test") {
        throw new Error(`unexpected_fetch:${url}`);
      }
      const body = JSON.parse(String(init?.body)) as WorkerCall;
      calls.push({ op: body.op, params: body.params });
      const data =
        body.op === "vector-similar" ? answers.similar : answers.query;
      if (!data) {
        throw new Error(`unexpected_op:${body.op}`);
      }
      return Promise.resolve(
        Response.json({ ok: true, version: 1, requestId: "r", data })
      );
    })
  );
  return calls;
};

type CardSeed = Partial<
  Pick<
    Doc<"cards">,
    "content" | "isArchived" | "isDeleted" | "type" | "userId" | "tags"
  >
>;

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_similar",
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
    cacheText: string,
    matches: { id: string; score: number }[],
    pending = false
  ) =>
    t.mutation(internal.search.semanticCache.storeRanking, {
      userId: "owner",
      key: await semanticSearchKey(cacheText),
      matches,
      ...(pending ? { pending: true } : {}),
    });
  const grid = async (args: Record<string, unknown>) => {
    const page: { page: { _id: string; matchedByMeaning?: true }[] } =
      await owner.query(api.cards.searchCardsPaginated, {
        ...args,
        paginationOpts: { numItems: 50, cursor: null },
      });
    return page.page.map((card) => card._id);
  };
  return { t, owner, insert, cache, grid };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "similar-test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const seedNeighbors = async (env: Awaited<ReturnType<typeof setup>>) => {
  const anchor = await env.insert({ content: "Concrete brutalist tower" });
  const near = await env.insert({ content: "Raw concrete stairwell" });
  const far = await env.insert({ content: "Window seat with books" });
  const image = await env.insert({ content: "Concrete facade", type: "image" });
  const trashed = await env.insert({
    content: "Concrete bench",
    isDeleted: true,
  });
  const archived = await env.insert({
    content: "Concrete chapel",
    isArchived: true,
  });
  const stranger = await env.insert({
    content: "Their concrete house",
    userId: "stranger",
  });
  const cards = { anchor, near, far, image, trashed, archived, stranger };
  await env.cache(`like\n${anchor}`, [
    { id: anchor, score: 1 },
    { id: near, score: 0.7 },
    { id: image, score: 0.6 },
    { id: trashed, score: 0.6 },
    { id: archived, score: 0.6 },
    { id: stranger, score: 0.6 },
    { id: far, score: 0.1 },
  ]);
  return cards;
};

describe("like: in the grid", () => {
  test("lists the card's neighbors, never the card itself, in the chosen order", async () => {
    const env = await setup();
    const cards = await seedNeighbors(env);
    expect(await env.grid({ searchQuery: `like:${cards.anchor}` })).toEqual([
      cards.image,
      cards.far,
      cards.near,
    ]);
    expect(
      await env.grid({ searchQuery: `like:${cards.anchor}`, sort: "oldest" })
    ).toEqual([cards.near, cards.far, cards.image]);
    const page = await env.owner.query(api.cards.searchCardsPaginated, {
      searchQuery: `like:${cards.anchor}`,
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(
      page.page.every(
        (card: { matchedByMeaning?: true }) => card.matchedByMeaning
      )
    ).toBe(true);
  });

  test("narrows by qualifiers, views and words", async () => {
    const env = await setup();
    const cards = await seedNeighbors(env);
    const like = `like:${cards.anchor}`;
    expect(await env.grid({ searchQuery: `${like} type:image` })).toEqual([
      cards.image,
    ]);
    expect(await env.grid({ searchQuery: `${like} stairwell` })).toEqual([
      cards.near,
    ]);
    expect(await env.grid({ searchQuery: `${like} (Stairwell),` })).toEqual([
      cards.near,
    ]);
    expect(
      await env.grid({ searchQuery: like, showArchivedOnly: true })
    ).toEqual([cards.archived]);
    expect(await env.grid({ searchQuery: like, showTrashOnly: true })).toEqual([
      cards.trashed,
    ]);
  });

  test("lists nothing for a card in Trash, another user's card, or before the ranking is cached", async () => {
    const env = await setup();
    const cards = await seedNeighbors(env);
    await env.t.run((ctx) =>
      ctx.db.patch("cards", cards.anchor, { isDeleted: true, deletedAt: 1 })
    );
    expect(await env.grid({ searchQuery: `like:${cards.anchor}` })).toEqual([]);
    expect(await env.grid({ searchQuery: `like:${cards.stranger}` })).toEqual(
      []
    );
    expect(await env.grid({ searchQuery: `like:${cards.near}` })).toEqual([]);
  });

  test("works from a smart folder's search", async () => {
    const env = await setup();
    const cards = await seedNeighbors(env);
    const folderId = await env.t.run((ctx) =>
      ctx.db.insert("folders", {
        userId: "owner",
        name: "Concrete",
        nameKey: "concrete",
        kind: "smart",
        query: `like:${cards.anchor} type:text`,
        activeCardCount: 0,
        createdAt: 1,
        updatedAt: 1,
      })
    );
    expect(await env.grid({ searchQuery: "", folderId })).toEqual([
      cards.far,
      cards.near,
    ]);
  });
});

test("mood: lists images that match well enough", async () => {
  const env = await setup();
  const moody = await env.insert({ content: "Dark concrete", type: "image" });
  const weak = await env.insert({ content: "Beach", type: "image" });
  const note = await env.insert({ content: "Moody notes" });
  await env.cache("mood\nmoody brutalist", [
    { id: moody, score: 0.5 },
    { id: note, score: 0.6 },
    { id: weak, score: 0.2 },
  ]);
  expect(await env.grid({ searchQuery: 'mood:"Moody  Brutalist"' })).toEqual([
    moody,
  ]);
  expect(
    await env.grid({ searchQuery: 'mood:"moody brutalist" type:link' })
  ).toEqual([]);
});

describe("requestSemanticResults for like: and mood:", () => {
  test("searches with the card's own vector and caches the neighbors", async () => {
    const env = await setup();
    const anchor = await env.insert({ content: "Concrete tower" });
    const near = await env.insert({ content: "Concrete stairs" });
    const calls = stubWorker({
      similar: { found: true, matches: [{ id: near, score: 0.7 }] },
    });
    expect(
      await env.owner.action(
        api.search.semanticActions.requestSemanticResults,
        {
          searchQuery: `like:${anchor}`,
        }
      )
    ).toEqual({ outcome: "ok" });
    expect(calls).toEqual([
      {
        op: "vector-similar",
        params: expect.objectContaining({ id: anchor, topK: 100 }),
      },
    ]);
    expect(await env.grid({ searchQuery: `like:${anchor}` })).toEqual([near]);
  });

  test("a card without a vector yet is pending, briefly", async () => {
    const env = await setup();
    const anchor = await env.insert({ content: "Just saved" });
    const calls = stubWorker({ similar: { found: false, matches: [] } });
    const request = () =>
      env.owner.action(api.search.semanticActions.requestSemanticResults, {
        searchQuery: `like:${anchor}`,
      });
    expect(await request()).toEqual({ outcome: "pending" });
    expect(await request()).toEqual({ outcome: "pending" });
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(16_000);
    await request();
    expect(calls).toHaveLength(2);
  });

  test("a card in Trash or someone else's is unavailable, with no vector call", async () => {
    const env = await setup();
    const trashed = await env.insert({ content: "Gone", isDeleted: true });
    const theirs = await env.insert({ content: "Theirs", userId: "stranger" });
    const calls = stubWorker({ similar: { found: true, matches: [] } });
    for (const cardId of [trashed, theirs]) {
      expect(
        await env.owner.action(
          api.search.semanticActions.requestSemanticResults,
          { searchQuery: `like:${cardId}` }
        )
      ).toEqual({ outcome: "anchor_unavailable" });
    }
    expect(calls).toEqual([]);
  });

  test("mood: asks for image vectors only, so notes can't crowd out the images", async () => {
    const env = await setup();
    const photo = await env.insert({
      content: "Fog over still water",
      type: "image",
    });
    const note = await env.insert({ content: "Calm meeting notes" });
    const calls = stubWorker({
      query: {
        matches: [
          { id: photo, score: 0.45 },
          { id: note, score: 0.5 },
        ],
      },
    });
    expect(
      await env.owner.action(
        api.search.semanticActions.requestSemanticResults,
        {
          searchQuery: 'mood:"Calm and Peaceful"',
        }
      )
    ).toEqual({ outcome: "ok" });
    expect(calls).toEqual([
      {
        op: "vector-query",
        params: expect.objectContaining({
          text: "calm and peaceful",
          type: "image",
        }),
      },
    ]);
    expect(await env.grid({ searchQuery: 'mood:"calm and peaceful"' })).toEqual(
      [photo]
    );
  });

  test("a search by meaning asks for every type", async () => {
    const env = await setup();
    const calls = stubWorker({ query: { matches: [] } });
    await env.owner.action(api.search.semanticActions.requestSemanticResults, {
      searchQuery: "calm and peaceful",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).not.toHaveProperty("type");
  });
});

test("the API lists a card's neighbors the same way", async () => {
  const env = await setup();
  const cards = await seedNeighbors(env);
  const ranking = [
    { cardId: cards.anchor, score: 1 },
    { cardId: cards.near, score: 0.7 },
    { cardId: cards.image, score: 0.6 },
    { cardId: cards.trashed, score: 0.6 },
    { cardId: cards.stranger, score: 0.6 },
  ];
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let index = 0; index < 5; index += 1) {
    const page = await env.t.query(internal.publicApi.searchCardsPageForUser, {
      userId: "owner",
      limit: 1,
      similarity: { kind: "like", cardId: cards.anchor },
      semanticRanking: ranking as { cardId: Id<"cards">; score: number }[],
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...page.items.map((card: { _id: string }) => card._id));
    if (!page.pageInfo.nextCursor) {
      break;
    }
    cursor = page.pageInfo.nextCursor;
  }
  expect(ids).toEqual([cards.image, cards.near]);
});

describe("similarAnchorSummary", () => {
  test("names the user's own card, and never anyone else's", async () => {
    const env = await setup();
    const mine = await env.insert({ content: "Concrete tower\nmore text" });
    const theirs = await env.insert({
      content: "Secret plans",
      userId: "stranger",
    });
    expect(
      await env.owner.query(api.cards.similarAnchorSummary, { cardId: mine })
    ).toEqual({ status: "pending", title: "Concrete tower" });
    await env.t.run(async (ctx) => {
      const row = await ctx.db
        .query("cardEmbeddings")
        .withIndex("by_cardId", (q) => q.eq("cardId", mine))
        .unique();
      if (row) {
        await ctx.db.patch("cardEmbeddings", row._id, {
          hash: "a".repeat(64),
          dueAt: undefined,
        });
      } else {
        await ctx.db.insert("cardEmbeddings", {
          cardId: mine,
          userId: "owner",
          hash: "a".repeat(64),
        });
      }
    });
    expect(
      await env.owner.query(api.cards.similarAnchorSummary, { cardId: mine })
    ).toEqual({ status: "ok", title: "Concrete tower" });
    expect(
      await env.owner.query(api.cards.similarAnchorSummary, { cardId: theirs })
    ).toEqual({ status: "unavailable" });
    expect(
      await env.owner.query(api.cards.similarAnchorSummary, {
        cardId: "not-an-id",
      })
    ).toEqual({ status: "unavailable" });
  });
});
