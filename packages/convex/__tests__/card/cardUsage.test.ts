process.env.SITE_URL = "https://teakvault.com";

import { describe, expect, test } from "bun:test";
import {
  CARD_USAGE_TOTAL_SHARDS,
  ensureCardUsageShards,
  getCardUsageSnapshot,
  initializeCardUsageShards,
  recordActiveCardCreated,
} from "../../card/cardUsage";
import { authorizeCardCreation } from "../../card/quota";
import { CARD_ERROR_CODES, FREE_TIER_LIMIT } from "../../shared/constants";
import { POLAR_PLAN_IDS } from "../../shared/polarPlans";
import { mockMutationCtx, testDoc, testId } from "../helpers/convex.test-utils";

const PREMIUM_SUBSCRIPTION = {
  status: "active",
  productId: POLAR_PLAN_IDS.development.monthly,
};

type Row = Record<string, unknown> & { _id: string };
interface IndexBuilder {
  eq: (field: string, value: unknown) => IndexBuilder;
}

const makeDb = () => {
  const store: Record<
    "accountDeletionStates" | "cards" | "userCardUsage" | "userCardUsageShards",
    Row[]
  > = {
    accountDeletionStates: [],
    cards: [],
    userCardUsage: [],
    userCardUsageShards: [],
  };
  const rowsOf = (table: string): Row[] =>
    store[table as keyof typeof store] ?? [];
  let nextId = 1;
  return {
    store,
    query: (table: string) => ({
      withIndex: (
        _name: string,
        callback: (builder: IndexBuilder) => unknown
      ) => {
        const conditions: [string, unknown][] = [];
        const builder: IndexBuilder = {
          eq: (field, value) => {
            conditions.push([field, value]);
            return builder;
          },
        };
        callback(builder);
        const rows = rowsOf(table).filter((row) =>
          conditions.every(([field, value]) => row[field] === value)
        );
        return {
          collect: async () => rows,
          first: async () => rows[0] ?? null,
          take: async (n: number) => rows.slice(0, n),
          unique: async () => rows[0] ?? null,
        };
      },
    }),
    insert: (table: keyof typeof store, doc: Record<string, unknown>) => {
      const _id = `${table}_${nextId++}`;
      store[table].push({ ...doc, _id });
      return Promise.resolve(_id);
    },
    get: (table: string, id: string) =>
      Promise.resolve(rowsOf(table).find((row) => row._id === id) ?? null),
    patch: (table: string, id: string, values: Record<string, unknown>) => {
      Object.assign(rowsOf(table).find((row) => row._id === id)!, values);
      return Promise.resolve();
    },
    delete: (table: keyof typeof store, id: string) => {
      store[table] = store[table].filter((row) => row._id !== id);
      return Promise.resolve();
    },
  };
};

const saturatedUsage = () =>
  testDoc("userCardUsage", {
    _id: testId("userCardUsage", "userCardUsage_1"),
    userId: "premium-user",
    activeCardCount: 201,
    isCountExact: false,
    isSaturated: true,
    updatedAt: 1,
  });

type CardCreationDeps = NonNullable<
  Parameters<typeof authorizeCardCreation>[2]
>;

const depsWith = (subscription: typeof PREMIUM_SUBSCRIPTION | null) =>
  ({
    getSubscription: async () => subscription,
    rateLimiter: { limit: async () => ({ ok: true }) },
  }) as unknown as CardCreationDeps;

const premiumDeps = () => depsWith(PREMIUM_SUBSCRIPTION);

const freeDeps = () => depsWith(null);

describe("card/cardUsage.ts premium sharding", () => {
  test("premium users with an inexact count can create cards", async () => {
    const db = makeDb();
    db.store.userCardUsage.push(saturatedUsage());
    const ctx = mockMutationCtx({ db });

    const { hasPremium } = await authorizeCardCreation(
      ctx,
      "premium-user",
      premiumDeps()
    );
    expect(hasPremium).toBe(true);
    expect(db.store.userCardUsageShards).toHaveLength(CARD_USAGE_TOTAL_SHARDS);

    await recordActiveCardCreated(
      ctx,
      "premium-user",
      testId("cards", "card_1"),
      {
        hasPremium,
      }
    );

    const snapshot = await getCardUsageSnapshot(ctx, "premium-user");
    expect(snapshot).toMatchObject({
      activeCardCount: 202,
      isCountExact: false,
    });
  });

  test("free users at the limit still get CARD_LIMIT_REACHED", async () => {
    const db = makeDb();
    db.store.userCardUsage.push(saturatedUsage());
    const ctx = mockMutationCtx({ db });

    const error = await authorizeCardCreation(
      ctx,
      "premium-user",
      freeDeps()
    ).catch((e) => e);
    expect(error?.data).toEqual({
      code: CARD_ERROR_CODES.CARD_LIMIT_REACHED,
      message: expect.any(String),
    });
    expect(db.store.userCardUsageShards).toHaveLength(0);
  });

  test("free users with an inexact count below the limit are still gated", async () => {
    const db = makeDb();
    db.store.userCardUsage.push({
      ...saturatedUsage(),
      activeCardCount: FREE_TIER_LIMIT - 1,
      isSaturated: false,
    });
    const ctx = mockMutationCtx({ db });

    const error = await authorizeCardCreation(
      ctx,
      "premium-user",
      freeDeps()
    ).catch((e) => e);
    expect(error?.data).toEqual({
      code: CARD_ERROR_CODES.CARD_LIMIT_REACHED,
      message: expect.any(String),
    });
    expect(db.store.userCardUsageShards).toHaveLength(0);
  });

  test("lapsed premium under the limit reconciles to exact shards", async () => {
    const db = makeDb();
    const userId = "lapsed-user";
    db.store.userCardUsage.push({
      _id: "userCardUsage_1",
      userId,
      activeCardCount: FREE_TIER_LIMIT + 1,
      isCountExact: false,
      isSaturated: true,
      shardVersion: 1,
      shardedAt: 1,
      updatedAt: 1,
    });
    for (let shard = 0; shard < 24; shard += 1) {
      db.store.userCardUsageShards.push({
        _id: `shard_${shard}`,
        userId,
        shard,
        activeCardCount: shard === 0 ? FREE_TIER_LIMIT + 1 : 0,
        updatedAt: 1,
      });
    }
    for (let card = 0; card < FREE_TIER_LIMIT - 1; card += 1) {
      db.store.cards.push({ _id: `card_${card}`, userId });
    }
    const ctx = mockMutationCtx({ db });

    await authorizeCardCreation(ctx, userId, freeDeps());

    const snapshot = await getCardUsageSnapshot(ctx, userId);
    expect(snapshot).toMatchObject({
      activeCardCount: FREE_TIER_LIMIT - 1,
      isCountExact: true,
    });
  });

  test("lapsed premium at the limit still gets CARD_LIMIT_REACHED", async () => {
    const db = makeDb();
    const userId = "lapsed-user";
    db.store.userCardUsage.push({
      _id: "userCardUsage_1",
      userId,
      activeCardCount: FREE_TIER_LIMIT + 1,
      isCountExact: false,
      isSaturated: true,
      shardVersion: 1,
      shardedAt: 1,
      updatedAt: 1,
    });
    for (let shard = 0; shard < 24; shard += 1) {
      db.store.userCardUsageShards.push({
        _id: `shard_${shard}`,
        userId,
        shard,
        activeCardCount: 0,
        updatedAt: 1,
      });
    }
    for (let card = 0; card < FREE_TIER_LIMIT; card += 1) {
      db.store.cards.push({ _id: `card_${card}`, userId });
    }
    const ctx = mockMutationCtx({ db });

    const error = await authorizeCardCreation(ctx, userId, freeDeps()).catch(
      (e) => e
    );
    expect(error?.data).toEqual({
      code: CARD_ERROR_CODES.CARD_LIMIT_REACHED,
      message: expect.any(String),
    });
  });

  test("inexact init without the premium flag still throws", async () => {
    const db = makeDb();
    const usage = saturatedUsage();
    db.store.userCardUsage.push(usage);
    const ctx = mockMutationCtx({ db });

    await expect(initializeCardUsageShards(ctx, usage)).rejects.toThrow(
      "Card usage must be exact before sharding"
    );
    await ensureCardUsageShards(ctx, "premium-user", true);
    expect(db.store.userCardUsageShards).toHaveLength(CARD_USAGE_TOTAL_SHARDS);
  });
});
