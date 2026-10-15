/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Pick<Doc<"cards">, "type"> &
  Partial<Omit<Doc<"cards">, "_id" | "_creationTime">>;

const categorized = (
  category: NonNullable<
    NonNullable<Doc<"cards">["metadata"]>["linkCategory"]
  >["category"],
  extra?: Record<string, unknown>
) => ({
  linkCategory: {
    category,
    confidence: 0.98,
    fetchedAt: 500,
    sourceUrl: "https://example.com",
    facts: [{ label: "Stars", value: "1,234" }],
    raw: { provider: { name: "github", stars: "1,234" } },
    ...extra,
  },
});

const setup = () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workflowTest.register(t);
  workosTest.register(t);
  const insert = (seed: CardSeed) =>
    t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner",
        content: "",
        createdAt: 1,
        updatedAt: 1,
        ...seed,
      })
    );
  const link = (url: string, metadata?: Doc<"cards">["metadata"]) =>
    insert({ type: "link", url, metadata });
  const category = async (id: Id<"cards">) =>
    (await t.run((ctx) => ctx.db.get("cards", id)))?.metadata?.linkCategory;
  const backfill = (args: {
    dryRun?: boolean;
    batchSize?: number;
    once?: boolean;
    cursor?: string | null;
    userId?: string;
  }) =>
    t.mutation(
      internal.migration.backfillLinkCategories.backfillLinkCategories,
      args
    );
  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, backfill, category, insert, link, runScheduled };
};

const seedLibrary = async ({
  insert,
  link,
}: Pick<ReturnType<typeof setup>, "insert" | "link">) => ({
  repo: await link(
    "https://github.com/vercel/next.js",
    categorized("software", { detectedProvider: "github" })
  ),
  game: await link("https://supergiant.itch.io/hades", categorized("software")),
  place: await link(
    "https://www.yelp.com/biz/tartine-bakery",
    categorized("other")
  ),
  // A heuristic or the fallback never moves a card.
  blog: await link("https://example.com/blog/post", categorized("news")),
  unknown: await link("https://unknown.example/page", categorized("article")),
  // Mastodon paths count only on the listed instances.
  blogPath: await link("https://example.com/@alice/123", categorized("other")),
  // A category a site's API confirmed stays.
  hinted: await link("https://social.example.org/@alice/123", {
    linkPreview: { status: "success", categoryHint: "social_post" },
    ...categorized("social_post"),
  }),
  alreadyRight: await link(
    "https://fonts.google.com/specimen/Inter",
    categorized("typeface")
  ),
  uncategorized: await link("https://www.yelp.com/biz/another"),
  note: await insert({ type: "text", content: "https://github.com/a/b" }),
});

describe("backfillLinkCategories", () => {
  test("a dry run counts every move per pair and writes nothing", async () => {
    const { backfill, category, insert, link } = setup();
    const cards = await seedLibrary({ insert, link });

    const result = await backfill({ batchSize: 50, once: true });

    expect(result.dryRun).toBe(true);
    expect(result.totals).toEqual({
      examined: 10,
      cardsToMove: 3,
      skippedDeletingAccounts: 0,
      moves: [
        { from: "software", to: "repo", count: 1 },
        { from: "software", to: "game", count: 1 },
        { from: "other", to: "place", count: 1 },
      ],
    });
    expect((await category(cards.repo))?.category).toBe("software");
    expect((await category(cards.place))?.category).toBe("other");
  });

  test("userId limits a run to one account", async () => {
    const { backfill, insert, link } = setup();
    await seedLibrary({ insert, link });
    expect(
      (await backfill({ batchSize: 50, once: true, userId: "owner" })).totals
        .cardsToMove
    ).toBe(3);
    expect(
      (await backfill({ batchSize: 50, once: true, userId: "someone-else" }))
        .totals.examined
    ).toBe(0);
  });

  test("a real run moves only the category and keeps facts, raw data and confidence", async () => {
    const { backfill, category, insert, link } = setup();
    const cards = await seedLibrary({ insert, link });
    const before = await category(cards.repo);

    const result = await backfill({ dryRun: false, batchSize: 50, once: true });

    expect(result.totals.cardsToMove).toBe(3);
    expect(await category(cards.repo)).toEqual({
      ...before,
      category: "repo",
    });
    expect((await category(cards.game))?.category).toBe("game");
    expect((await category(cards.place))?.category).toBe("place");
    for (const unchanged of [
      ["blog", "news"],
      ["unknown", "article"],
      ["blogPath", "other"],
      ["hinted", "social_post"],
      ["alreadyRight", "typeface"],
    ] as const) {
      expect((await category(cards[unchanged[0]]))?.category).toBe(
        unchanged[1]
      );
    }
    expect(await category(cards.uncategorized)).toBeUndefined();
  });

  test("pages through the table, and a second run moves nothing", async () => {
    const { backfill, category, insert, link, runScheduled } = setup();
    const cards = await seedLibrary({ insert, link });

    const dry = await backfill({ batchSize: 3 });
    expect(dry.continuationScheduled).toBe(true);
    await runScheduled();

    const first = await backfill({ dryRun: false, batchSize: 3, once: true });
    expect(first).toMatchObject({
      isDone: false,
      continuationScheduled: false,
    });
    // Resuming from the cursor finishes the rest.
    await backfill({
      dryRun: false,
      batchSize: 3,
      cursor: first.continueCursor,
    });
    await runScheduled();
    expect((await category(cards.place))?.category).toBe("place");

    const again = await backfill({ batchSize: 50, once: true });
    expect(again.totals).toMatchObject({ examined: 10, cardsToMove: 0 });
  });

  test("leaves the cards of an account being deleted alone", async () => {
    const { t, backfill, category, link } = setup();
    const leaving = await t.run(async (ctx) => {
      await ctx.db.insert("accountDeletionStates", {
        userId: "leaver",
        startedAt: 1,
      });
      return await ctx.db.insert("cards", {
        userId: "leaver",
        type: "link",
        url: "https://github.com/vercel/next.js",
        content: "",
        createdAt: 1,
        updatedAt: 1,
        metadata: categorized("software"),
      });
    });
    const staying = await link(
      "https://github.com/vercel/next.js",
      categorized("software")
    );

    const result = await backfill({ dryRun: false, once: true });

    expect(result.totals).toMatchObject({
      cardsToMove: 1,
      skippedDeletingAccounts: 1,
    });
    expect((await category(leaving))?.category).toBe("software");
    expect((await category(staying))?.category).toBe("repo");
  });
});
