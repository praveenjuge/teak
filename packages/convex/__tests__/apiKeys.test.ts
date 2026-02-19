// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import {
  createUserApiKey,
  listUserApiKeys,
  revokeAllActiveApiKeysForPrefixCutover,
  revokeUserApiKey,
  validateUserApiKey,
} from "../apiKeys";

process.env.BETTER_AUTH_SECRET = "unit-test-pepper";

const runHandler = async (fn: any, ctx: any, args: any) => {
  const handler = (fn as any).handler ?? fn;
  return handler(ctx, args);
};

describe("apiKeys", () => {
  test("create stores only hashed key and revokes active key", async () => {
    const collectMock = mock()
      .mockResolvedValueOnce([
        {
          _id: "old_key",
          userId: "user_1",
          revokedAt: undefined,
        },
      ])
      .mockResolvedValueOnce([]);

    const db = {
      query: mock(() => ({
        withIndex: mock(() => ({
          collect: collectMock,
          order: mock(() => ({ collect: collectMock })),
        })),
      })),
      patch: mock().mockResolvedValue(null),
      insert: mock().mockResolvedValue("new_key"),
      get: mock(),
    };

    const ctx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({ subject: "user_1" }),
      },
      db,
    };

    const result = await runHandler(createUserApiKey, ctx, {
      name: "API Keys",
    });

    expect(result.id).toBe("new_key");
    expect(result.key).toStartWith("teakapi_");
    expect(db.patch).toHaveBeenCalledWith(
      "apiKeys",
      "old_key",
      expect.objectContaining({ revokedAt: expect.any(Number) })
    );

    const insertCall = db.insert.mock.calls[0];
    expect(insertCall[0]).toBe("apiKeys");
    expect(insertCall[1].keyHash).toBeString();
    expect(insertCall[1].keyHash).not.toContain(result.key);
    expect(insertCall[1]).not.toHaveProperty("key");
  });

  test("list returns masked key metadata", async () => {
    const collectMock = mock().mockResolvedValue([
      {
        _id: "k1",
        userId: "user_1",
        name: "API Keys",
        keyPrefix: "abc123",
        access: "full_access",
        createdAt: 100,
        updatedAt: 200,
        lastUsedAt: 150,
        revokedAt: undefined,
      },
    ]);

    const ctx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({ subject: "user_1" }),
      },
      db: {
        query: mock(() => ({
          withIndex: mock(() => ({
            collect: collectMock,
            order: mock(() => ({ collect: collectMock })),
          })),
        })),
      },
    };

    const result = await runHandler(listUserApiKeys, ctx, {});
    expect(result).toHaveLength(1);
    expect(result[0].maskedKey).toContain("••••••••");
    expect(result[0].access).toBe("full_access");
  });

  test("revoke marks selected key as revoked", async () => {
    const ctx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({ subject: "user_1" }),
      },
      db: {
        get: mock().mockResolvedValue({
          _id: "k1",
          userId: "user_1",
          revokedAt: undefined,
        }),
        patch: mock().mockResolvedValue(null),
      },
    };

    await runHandler(revokeUserApiKey, ctx, { keyId: "k1" });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "apiKeys",
      "k1",
      expect.objectContaining({ revokedAt: expect.any(Number) })
    );
  });

  test("validate accepts valid key and updates lastUsedAt", async () => {
    const createCollectMock = mock().mockResolvedValue([]);
    const createDb = {
      query: mock(() => ({
        withIndex: mock(() => ({
          collect: createCollectMock,
          order: mock(() => ({ collect: createCollectMock })),
        })),
      })),
      patch: mock().mockResolvedValue(null),
      insert: mock().mockResolvedValue("k_new"),
    };

    const createCtx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({ subject: "user_1" }),
      },
      db: createDb,
    };

    const created = await runHandler(createUserApiKey, createCtx, {
      name: "API Keys",
    });

    const insertedPayload = createDb.insert.mock.calls[0][1];

    const validateCollectMock = mock().mockResolvedValue([
      {
        _id: "k_new",
        userId: "user_1",
        keyPrefix: insertedPayload.keyPrefix,
        keyHash: insertedPayload.keyHash,
        access: "full_access",
        revokedAt: undefined,
      },
    ]);

    const validateCtx = {
      runQuery: mock().mockResolvedValue({
        _id: "user_1",
      }),
      db: {
        query: mock(() => ({
          withIndex: mock(() => ({
            collect: validateCollectMock,
          })),
        })),
        patch: mock().mockResolvedValue(null),
      },
    };

    const result = await runHandler(validateUserApiKey, validateCtx, {
      token: created.key,
    });

    expect(result).toEqual({
      keyId: "k_new",
      userId: "user_1",
      access: "full_access",
    });
    expect(validateCtx.db.patch).toHaveBeenCalledWith(
      "apiKeys",
      "k_new",
      expect.objectContaining({ lastUsedAt: expect.any(Number) })
    );
    expect(validateCtx.runQuery).toHaveBeenCalled();
  });

  test("validate rejects invalid key", async () => {
    const ctx = {
      db: {
        query: mock(() => ({
          withIndex: mock(() => ({ collect: mock().mockResolvedValue([]) })),
        })),
        patch: mock(),
      },
    };

    const result = await runHandler(validateUserApiKey, ctx, {
      token: "teakapi_badprefix_secret",
    });

    expect(result).toBeNull();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  test("validate revokes matched key when auth user no longer exists", async () => {
    const createCollectMock = mock().mockResolvedValue([]);
    const createDb = {
      query: mock(() => ({
        withIndex: mock(() => ({
          collect: createCollectMock,
          order: mock(() => ({ collect: createCollectMock })),
        })),
      })),
      patch: mock().mockResolvedValue(null),
      insert: mock().mockResolvedValue("k_deleted"),
    };

    const createCtx = {
      auth: {
        getUserIdentity: mock().mockResolvedValue({ subject: "deleted_user" }),
      },
      db: createDb,
    };

    const created = await runHandler(createUserApiKey, createCtx, {
      name: "API Keys",
    });
    const insertedPayload = createDb.insert.mock.calls[0][1];
    const matchedCandidate = {
      _id: "k_deleted",
      userId: "deleted_user",
      keyPrefix: insertedPayload.keyPrefix,
      keyHash: insertedPayload.keyHash,
      access: "full_access",
      revokedAt: undefined,
    };
    const validateCollectMock = mock().mockResolvedValue([matchedCandidate]);

    const validateCtx = {
      runQuery: mock().mockResolvedValue(null),
      db: {
        query: mock(() => ({
          withIndex: mock(() => ({
            collect: validateCollectMock,
          })),
        })),
        patch: mock().mockResolvedValue(null),
      },
    };

    const result = await runHandler(validateUserApiKey, validateCtx, {
      token: created.key,
    });

    expect(result).toBeNull();
    expect(validateCtx.db.patch).toHaveBeenCalledWith(
      "apiKeys",
      "k_deleted",
      expect.objectContaining({ revokedAt: expect.any(Number) })
    );
  });

  test("cutover revoke-all revokes every active key", async () => {
    const activeKeys = [
      { _id: "k1", revokedAt: undefined },
      { _id: "k2", revokedAt: undefined },
    ];

    const ctx = {
      db: {
        query: mock(() => ({
          filter: mock(() => ({
            collect: mock().mockResolvedValue(activeKeys),
          })),
        })),
        patch: mock().mockResolvedValue(null),
      },
    };

    const result = await runHandler(
      revokeAllActiveApiKeysForPrefixCutover,
      ctx,
      {}
    );

    expect(result.revokedCount).toBe(2);
    expect(result.revokedAt).toEqual(expect.any(Number));
    expect(ctx.db.patch).toHaveBeenCalledTimes(2);
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "apiKeys",
      "k1",
      expect.objectContaining({ revokedAt: expect.any(Number) })
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "apiKeys",
      "k2",
      expect.objectContaining({ revokedAt: expect.any(Number) })
    );
  });
});
