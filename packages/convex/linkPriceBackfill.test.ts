/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { syncCardSearchDocumentHandler } from "./card/searchDocumentHelpers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type LinkCategory = NonNullable<
  NonNullable<Doc<"cards">["metadata"]>["linkCategory"]
>;

const setup = () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workflowTest.register(t);
  workosTest.register(t);
  let nextCreatedAt = 1;
  /** A link card saved before prices were structured. */
  const insert = (
    content: string,
    linkCategory: Partial<LinkCategory> | undefined,
    extra: Partial<Doc<"cards">> = {}
  ) => {
    nextCreatedAt += 1;
    const createdAt = nextCreatedAt;
    return t.run(async (ctx) => {
      const url = `https://shop.example/${createdAt}`;
      const id = await ctx.db.insert("cards", {
        userId: "owner",
        type: "link",
        content,
        url,
        metadata: linkCategory
          ? {
              linkCategory: {
                category: "product",
                fetchedAt: 1,
                sourceUrl: url,
                ...linkCategory,
              },
            }
          : undefined,
        createdAt,
        updatedAt: createdAt,
        ...extra,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });
  };
  const priceOf = async (cardId: Id<"cards">) =>
    (await t.run((ctx) => ctx.db.get("cards", cardId)))?.metadata?.linkCategory
      ?.price;
  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const backfill = (args: {
    dryRun?: boolean;
    batchSize?: number;
    once?: boolean;
    cursor?: string | null;
    userId?: string;
  }) =>
    t.mutation(internal.migration.backfillLinkPrice.backfillLinkPrice, args);
  return { t, insert, priceOf, runScheduled, backfill };
};

const priceFact = (value: string) => [{ label: "Price", value }];

/** One card for each source and each way a card is left alone. */
const seedLibrary = async (env: ReturnType<typeof setup>) => ({
  // JSON-LD offers win over the provider's price and the fact.
  structured: await env.insert("JSON-LD lamp", {
    raw: {
      structured: {
        "@type": "Product",
        offers: [
          { price: "30.00", priceCurrency: "EUR" },
          { price: "25.00", priceCurrency: "EUR" },
        ],
      },
      provider: { name: "amazon", price: "$99.00", currency: "USD" },
    },
    facts: priceFact("$99.00 USD"),
  }),
  // The provider's price wins over the fact.
  provider: await env.insert("Amazon lamp", {
    detectedProvider: "amazon",
    raw: { provider: { name: "amazon", price: "₹2,499.00", currency: "INR" } },
    facts: priceFact("$1.00"),
  }),
  fact: await env.insert("Fact-only lamp", {
    facts: priceFact("1.299,00 €"),
  }),
  // Raw moved to R2; the fact still prices it.
  archivedWithFact: await env.insert("Archived lamp with a fact", {
    rawStorageKey: "users/owner/raw.json",
    rawSha256: "a".repeat(64),
    facts: priceFact("$15.00 USD"),
  }),
  // Raw moved to R2 and no fact: never read, counted.
  archivedOnly: await env.insert("Archived lamp", {
    rawStorageKey: "users/owner/raw2.json",
    rawSha256: "b".repeat(64),
  }),
  unparsable: await env.insert("Contact us lamp", {
    facts: priceFact("Contact us"),
  }),
  alreadyPriced: await env.insert("Priced lamp", {
    price: { amount: 3, currency: "USD" },
    facts: priceFact("$50.00"),
  }),
  article: await env.insert("An article", { category: "article" }),
  // Only products get a price, whatever else the page states.
  course: await env.insert("A course article", {
    category: "article",
    facts: priceFact("$20.00"),
    raw: { structured: { offers: { price: "20.00", priceCurrency: "USD" } } },
  }),
  plainLink: await env.insert("No category", undefined),
});

describe("backfillLinkPrice", () => {
  test("a dry run reports the totals and writes nothing", async () => {
    const env = setup();
    const cards = await seedLibrary(env);
    const result = await env.backfill({});
    await env.runScheduled();
    expect(result).toMatchObject({ dryRun: true, isDone: true });
    expect(result.totals).toEqual({
      examined: 10,
      priced: 4,
      skippedArchivedRaw: 1,
      unparsable: 1,
      skippedDeletingAccounts: 0,
    });
    expect(await env.priceOf(cards.structured)).toBeUndefined();
    expect(await env.priceOf(cards.fact)).toBeUndefined();
    expect(await env.priceOf(cards.alreadyPriced)).toEqual({
      amount: 3,
      currency: "USD",
    });
  });

  test("userId limits a run to one account", async () => {
    const env = setup();
    await seedLibrary(env);
    expect((await env.backfill({ userId: "owner" })).totals.priced).toBe(4);
    expect(
      (await env.backfill({ userId: "someone-else" })).totals.examined
    ).toBe(0);
  });

  test("a real run takes the first source with a price, page by page", async () => {
    const env = setup();
    const cards = await seedLibrary(env);
    const first = await env.backfill({
      dryRun: false,
      batchSize: 4,
      once: true,
    });
    expect(first).toMatchObject({
      isDone: false,
      continuationScheduled: false,
      batch: { examined: 4, priced: 4 },
    });
    // The rest resumes from the cursor and schedules itself to the end.
    const rest = await env.backfill({
      dryRun: false,
      batchSize: 4,
      cursor: first.continueCursor,
    });
    expect(rest.continuationScheduled).toBe(true);
    await env.runScheduled();

    expect(await env.priceOf(cards.structured)).toEqual({
      amount: 25,
      currency: "EUR",
    });
    expect(await env.priceOf(cards.provider)).toEqual({
      amount: 2499,
      currency: "INR",
    });
    expect(await env.priceOf(cards.fact)).toEqual({
      amount: 1299,
      currency: "EUR",
    });
    expect(await env.priceOf(cards.archivedWithFact)).toEqual({
      amount: 15,
      currency: "USD",
    });
    expect(await env.priceOf(cards.archivedOnly)).toBeUndefined();
    expect(await env.priceOf(cards.unparsable)).toBeUndefined();
    expect(await env.priceOf(cards.course)).toBeUndefined();
    expect(await env.priceOf(cards.alreadyPriced)).toEqual({
      amount: 3,
      currency: "USD",
    });

    // Running it again finds nothing to add.
    const again = await env.backfill({ once: true });
    expect(again.batch).toEqual({
      examined: 10,
      priced: 0,
      skippedArchivedRaw: 1,
      unparsable: 1,
      skippedDeletingAccounts: 0,
    });
  });

  test("a written price makes the card match price:", async () => {
    const env = setup();
    await seedWorkosOwner(env.t, "owner");
    const cards = await seedLibrary(env);
    await env.backfill({ dryRun: false });
    await env.runScheduled();
    const page = await env.t.query(internal.publicApi.scanCardsPageForUser, {
      userId: "owner",
      scanLimit: 50,
      type: "link",
      prices: [{ op: "<", amount: 20 }],
    });
    expect(page.items.map((card: { _id: string }) => card._id)).toEqual([
      cards.alreadyPriced,
      cards.archivedWithFact,
    ]);
  });

  test("keeps a price a refresh wrote between the read and the write", async () => {
    const env = setup();
    const cardId = await env.insert("Refreshed lamp", {
      facts: priceFact("$40.00"),
    });
    await env.backfill({ dryRun: false });
    // Refresh details lands before the queued write runs, and changes
    // another field too.
    await env.t.run(async (ctx) => {
      const card = await ctx.db.get("cards", cardId);
      const linkCategory = card?.metadata?.linkCategory as LinkCategory;
      await ctx.db.patch("cards", cardId, {
        metadata: {
          ...card?.metadata,
          linkCategory: { ...linkCategory, price: { amount: 35 } },
        },
      });
    });
    await env.runScheduled();
    expect(await env.priceOf(cardId)).toEqual({ amount: 35 });
  });

  test("leaves a card a refresh moved out of products before the write", async () => {
    const env = setup();
    const cardId = await env.insert("Lamp review", {
      facts: priceFact("$40.00"),
    });
    await env.backfill({ dryRun: false });
    await env.t.run(async (ctx) => {
      const card = await ctx.db.get("cards", cardId);
      const linkCategory = card?.metadata?.linkCategory as LinkCategory;
      await ctx.db.patch("cards", cardId, {
        metadata: {
          ...card?.metadata,
          linkCategory: { ...linkCategory, category: "article" },
        },
      });
    });
    await env.runScheduled();
    expect(await env.priceOf(cardId)).toBeUndefined();
  });

  test("merges the price into the card's metadata as it is when written", async () => {
    const env = setup();
    const cardId = await env.insert("Lamp", { facts: priceFact("$40.00") });
    await env.backfill({ dryRun: false });
    await env.t.run(async (ctx) => {
      const card = await ctx.db.get("cards", cardId);
      await ctx.db.patch("cards", cardId, {
        metadata: {
          ...card?.metadata,
          linkPreview: { status: "success", title: "Fresh title" },
        },
      });
    });
    await env.runScheduled();
    const card = await env.t.run((ctx) => ctx.db.get("cards", cardId));
    expect(card?.metadata?.linkPreview?.title).toBe("Fresh title");
    expect(card?.metadata?.linkCategory?.price).toEqual({
      amount: 40,
      currency: "USD",
    });
    expect(card?.updatedAt).toBe(1_000_000);
  });

  test("leaves accounts being deleted alone", async () => {
    const env = setup();
    const cardId = await env.insert("Lamp", { facts: priceFact("$40.00") });
    await env.t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        startedAt: Date.now(),
        userId: "owner",
      })
    );
    const result = await env.backfill({ dryRun: false });
    await env.runScheduled();
    expect(result.totals).toMatchObject({
      priced: 0,
      skippedDeletingAccounts: 1,
    });
    expect(await env.priceOf(cardId)).toBeUndefined();
  });
});
