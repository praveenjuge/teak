// @ts-nocheck
process.env.SITE_URL = "https://teakvault.com";

import { describe, expect, test } from "bun:test";
import { CARD_ERROR_CODES, FREE_TIER_LIMIT } from "../../shared/constants";
import { POLAR_PLAN_IDS } from "../../shared/polarPlans";
import { authorizeCardCreation } from "../../card/quota";
import {
  CARD_USAGE_TOTAL_SHARDS,
  ensureCardUsageShards,
  getCardUsageSnapshot,
  initializeCardUsageShards,
  recordActiveCardCreated,
} from "../../card/cardUsage";

const PREMIUM_SUBSCRIPTION = {
  status: "active",
  productId: POLAR_PLAN_IDS.development.monthly,
};

const makeDb = () => {
  const store = {
    accountDeletionStates: [],
    cards: [],
    userCardUsage: [],
    userCardUsageShards: [],
  };
  let nextId = 1;
  return {
    store,
    query: (table) => ({
      withIndex: (_name, callback) => {
        const conditions = [];
        const builder = {
          eq: (field, value) => {
            conditions.push([field, value]);
            return builder;
          },
        };
        callback(builder);
        const rows = (store[table] ?? []).filter((row) =>
          conditions.every(([field, value]) => row[field] === value)
        );
        return {
          collect: async () => rows,
          first: async () => rows[0] ?? null,
          take: async (n) => rows.slice(0, n),
          unique: async () => rows[0] ?? null,
        };
      },
    }),
    insert: async (table, doc) => {
      const _id = `${table}_${nextId++}`;
      store[table].push({ ...doc, _id });
      return _id;
    },
    get: async (table, id) =>
      (store[table] ?? []).find((row) => row._id === id) ?? null,
    patch: async (table, id, values) => {
      Object.assign(
        (store[table] ?? []).find((row) => row._id === id),
        values
      );
    },
    delete: async (table, id) => {
      store[table] = (store[table] ?? []).filter((row) => row._id !== id);
    },
  };
};

const saturatedUsage = () => ({
  _id: "userCardUsage_1",
  userId: "premium-user",
  activeCardCount: 201,
  isCountExact: false,
  isSaturated: true,
  updatedAt: 1,
});

const premiumDeps = () => ({
  getSubscription: async () => PREMIUM_SUBSCRIPTION,
  rateLimiter: { limit: async () => ({ ok: true }) },
});

const freeDeps = () => ({
  getSubscription: async () => null,
  rateLimiter: { limit: async () => ({ ok: true }) },
});

describe("card/cardUsage.ts premium sharding", () => {
  test("premium users with an inexact count can create cards", async () => {
    const db = makeDb();
    db.store.userCardUsage.push(saturatedUsage());
    const ctx = { db };

    const { hasPremium } = await authorizeCardCreation(
      ctx,
      "premium-user",
      premiumDeps()
    );
    expect(hasPremium).toBe(true);
    expect(db.store.userCardUsageShards).toHaveLength(CARD_USAGE_TOTAL_SHARDS);

    await recordActiveCardCreated(ctx, "premium-user", "card_1", {
      hasPremium,
    });

    const snapshot = await getCardUsageSnapshot(ctx, "premium-user");
    expect(snapshot.activeCardCount).toBe(202);
    expect(snapshot.isCountExact).toBe(false);
  });

  test("free users at the limit still get CARD_LIMIT_REACHED", async () => {
    const db = makeDb();
    db.store.userCardUsage.push(saturatedUsage());
    const ctx = { db };

    const error = await authorizeCardCreation(ctx, "premium-user", freeDeps()).catch(
      (e) => e
    );
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
    const ctx = { db };

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
    const ctx = { db };

    await authorizeCardCreation(ctx, userId, freeDeps());

    const snapshot = await getCardUsageSnapshot(ctx, userId);
    expect(snapshot.activeCardCount).toBe(FREE_TIER_LIMIT - 1);
    expect(snapshot.isCountExact).toBe(true);
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
    const ctx = { db };

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
    const ctx = { db };

    await expect(initializeCardUsageShards(ctx, usage)).rejects.toThrow(
      "Card usage must be exact before sharding"
    );
    await ensureCardUsageShards(ctx, "premium-user", true);
    expect(db.store.userCardUsageShards).toHaveLength(CARD_USAGE_TOTAL_SHARDS);
  });
});
