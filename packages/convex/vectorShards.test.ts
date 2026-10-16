/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("vector shards", () => {
  test("places a new user on the current shard, in a namespace of their own", async () => {
    const t = convexTest(schema, modules);
    expect(
      await t.mutation(internal.vectorShards.assignVectorShard, {
        userId: "teak_user_a",
      })
    ).toEqual({ namespace: "teak_user_a", shard: 0 });
    expect(
      await t.mutation(internal.vectorShards.assignVectorShard, {
        userId: "teak_user_b",
      })
    ).toEqual({ namespace: "teak_user_b", shard: 0 });
  });

  test("keeps a user on the shard they were first placed on", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("vectorShards", { userId: "teak_user_a", shard: 3 })
    );
    for (let i = 0; i < 2; i++) {
      expect(
        await t.mutation(internal.vectorShards.assignVectorShard, {
          userId: "teak_user_a",
        })
      ).toEqual({ namespace: "teak_user_a", shard: 3 });
    }
    expect(
      await t.run((ctx) => ctx.db.query("vectorShards").collect())
    ).toHaveLength(1);
  });

  test("refuses a user id too long to be a Vectorize namespace", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.vectorShards.assignVectorShard, {
        userId: "x".repeat(65),
      })
    ).rejects.toThrow("vector_namespace_invalid");
    expect(
      await t.run((ctx) => ctx.db.query("vectorShards").collect())
    ).toEqual([]);
  });
});
