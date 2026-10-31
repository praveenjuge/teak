import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import schema from "../schema";
import { relevanceSearchKey } from "../shared/search/relevance";

const modules = import.meta.glob("../**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  const workosUserId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_bestmatch",
    email_verified: true,
    external_id: "owner",
  });
  let nextCreatedAt = 1000;
  const insert = (content: string) => {
    nextCreatedAt += 1;
    const createdAt = nextCreatedAt;
    return t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content,
        createdAt,
        updatedAt: createdAt,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });
  };
  const score = async (
    text: string,
    scores: { cardId: Id<"cards">; score: number }[]
  ) => {
    const cards = await t.run((ctx) =>
      Promise.all(scores.map((entry) => ctx.db.get("cards", entry.cardId)))
    );
    return t.mutation(internal.search.relevanceCache.storeScores, {
      userId: "owner",
      key: await relevanceSearchKey(text),
      scores: scores.map((entry, index) => ({
        ...entry,
        cardUpdatedAt: cards[index]?.updatedAt ?? 0,
      })),
    });
  };
  const grid = async (args: Record<string, unknown>) =>
    (
      await owner.query(api.cards.searchCardsPaginated, {
        ...args,
        paginationOpts: { numItems: 20, cursor: null },
      })
    ).page.map((card: { _id: string }) => card._id);
  return { t, owner, insert, score, grid };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Best match in the grid", () => {
  test("orders by the cached scores when asked, else keeps search order", async () => {
    const env = await setup();
    const older = await env.insert("soup for a cold evening");
    const middle = await env.insert("soup stock basics");
    const newer = await env.insert("tomato soup");
    await env.score("soup", [
      { cardId: older, score: 3 },
      { cardId: newer, score: 0.5 },
      { cardId: middle, score: 2 },
    ]);

    expect(
      await env.grid({
        searchQuery: "soup",
        sort: "relevance",
        useRelevanceScores: true,
        mode: "keyword",
      })
    ).toEqual([older, middle, newer]);

    const newest = await env.grid({ searchQuery: "soup", mode: "keyword" });
    expect(newest).toEqual([newer, middle, older]);
  });

  test("an edited card's old score no longer counts", async () => {
    const env = await setup();
    const first = await env.insert("soup one");
    const second = await env.insert("soup two");
    await env.score("soup", [
      { cardId: first, score: 3 },
      { cardId: second, score: 1 },
    ]);
    await env.t.run((ctx) =>
      ctx.db.patch("cards", first, { updatedAt: 99_999 })
    );
    const ids = await env.grid({
      searchQuery: "soup",
      sort: "relevance",
      useRelevanceScores: true,
      mode: "keyword",
    });
    expect(ids[0]).toBe(second);
  });

  test("Best match without words to match orders by newest", async () => {
    const env = await setup();
    const first = await env.insert("a");
    const second = await env.insert("b");
    expect(await env.grid({ sort: "relevance" })).toEqual([second, first]);
  });
});

describe("Best match in the API", () => {
  const page = (
    env: Awaited<ReturnType<typeof setup>>,
    args: Record<string, unknown>
  ) =>
    env.t.query(internal.publicApi.searchCardsPageForUser, {
      userId: "owner",
      searchQuery: "soup",
      limit: 1,
      ...args,
    });

  test("pages keep the first page's order, scored or not", async () => {
    const env = await setup();
    const a = await env.insert("soup a");
    const b = await env.insert("soup b");
    const c = await env.insert("soup c");
    const scores = [
      { cardId: a, score: 3, cardUpdatedAt: 1001 },
      { cardId: c, score: 2, cardUpdatedAt: 1003 },
      { cardId: b, score: 1, cardUpdatedAt: 1002 },
    ];
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let index = 0; index < 5; index += 1) {
      const result = await page(env, { relevance: { scores }, cursor });
      ids.push(...result.items.map((card: { _id: string }) => card._id));
      cursor = result.pageInfo.nextCursor ?? undefined;
      if (!cursor) {
        break;
      }
    }
    expect(ids).toEqual([a, c, b]);
  });

  test("a cursor from an unscored first page can't continue scored", async () => {
    const env = await setup();
    await env.insert("soup a");
    await env.insert("soup b");
    const first = await page(env, { relevance: {} });
    await expect(
      page(env, {
        relevance: { scores: [] },
        cursor: first.pageInfo.nextCursor,
      })
    ).rejects.toThrow("cursor");
  });

  test("a Best match cursor needs Best match", async () => {
    const env = await setup();
    await env.insert("soup a");
    await env.insert("soup b");
    const first = await page(env, { relevance: {} });
    await expect(
      page(env, { cursor: first.pageInfo.nextCursor })
    ).rejects.toThrow("cursor");
  });
});

test("scores of another user's cards are never stored", async () => {
  const env = await setup();
  const mine = await env.insert("soup");
  const theirs = await env.t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: "stranger",
      type: "text",
      content: "soup",
      createdAt: 1,
      updatedAt: 1,
    })
  );
  await env.t.mutation(internal.search.relevanceCache.storeScores, {
    userId: "owner",
    key: await relevanceSearchKey("soup"),
    scores: [
      { cardId: mine, score: 2, cardUpdatedAt: 1 },
      { cardId: theirs, score: 3, cardUpdatedAt: 1 },
    ],
  });
  const row = await env.t.run((ctx) =>
    ctx.db.query("searchRelevanceResults").first()
  );
  expect(row?.scores.map((entry) => entry.cardId)).toEqual([mine]);
});
