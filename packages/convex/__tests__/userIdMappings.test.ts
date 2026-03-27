// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

describe("userIdMappings.ts", () => {
  let module: any;

  beforeEach(async () => {
    module = await import("../userIdMappings");
  });

  test("creates a pending legacy mapping when none exists", async () => {
    const take = mock().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const ctx = {
      db: {
        insert: mock().mockResolvedValue("mapping1"),
        patch: mock(),
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            take,
          }),
        }),
      },
    };

    const result = await module.upsertBetterAuthMappingInDb(ctx, {
      betterAuthId: "ba_123",
      email: "user@example.com",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith("userIdMappings", {
      betterAuthId: "ba_123",
      clerkId: undefined,
      email: "user@example.com",
      migrationStatus: "pending",
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      mappedAt: undefined,
    });
    expect(result).toEqual({ action: "created", id: "mapping1" });
  });

  test("activates a Clerk mapping when email already exists", async () => {
    const existingMapping = {
      _id: "mapping1",
      betterAuthId: "ba_123",
      clerkId: undefined,
      email: "user@example.com",
      migrationStatus: "pending",
      mappedAt: undefined,
    };
    const take = mock()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existingMapping]);
    const ctx = {
      db: {
        insert: mock(),
        patch: mock().mockResolvedValue(null),
        query: mock().mockReturnValue({
          withIndex: mock().mockReturnValue({
            take,
          }),
        }),
      },
    };

    const result = await module.upsertClerkMappingInDb(ctx, {
      clerkId: "user_123",
      email: "user@example.com",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith("userIdMappings", "mapping1", {
      clerkId: "user_123",
      email: "user@example.com",
      migrationStatus: "active",
      mappedAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(result).toEqual({ action: "updated", id: "mapping1" });
  });

  test("legacy backfill becomes a no-op after Clerk cutover", async () => {
    const ctx = {};

    const result = await module.backfillBetterAuthUserMappingsHandler(ctx, {
      batchSize: 10,
      cursor: null,
    });

    expect(result).toEqual({
      created: 0,
      updated: 0,
      skipped: 10,
      nextCursor: null,
      isDone: true,
    });
  });
});
