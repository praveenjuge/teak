// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";

import {
  createUserApiKey,
  listUserApiKeys,
  revokeAllActiveApiKeysForPrefixCutover,
  revokeUserApiKey,
  rotateUserApiKey,
  validateUserApiKey,
} from "../apiKeys";

process.env.BETTER_AUTH_SECRET = "unit-test-pepper";

const runHandler = (fn: any, ctx: any, args: any) => {
  const handler = (fn as any).handler ?? fn;
  return handler(ctx, args);
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const hashLegacyApiKey = async (key: string): Promise<string> => {
  const payload = `${key}:${process.env.BETTER_AUTH_SECRET ?? ""}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload)
  );
  return toHex(new Uint8Array(digest));
};

const componentKey = {
  createdAt: 300,
  env: "live",
  keyId: "component_key",
  lastUsedAt: 350,
  lookupPrefix: "a1b2c3d4",
  metadata: undefined,
  name: "SDK Key",
  remaining: undefined,
  scopes: ["full_access"],
  status: "active",
  tags: [],
  type: "secret",
};

const buildLegacyQuery = (rows: any[]) => ({
  withIndex: mock(() => ({
    collect: mock().mockResolvedValue(rows),
    order: mock(() => ({
      take: mock().mockResolvedValue(rows),
    })),
    take: mock().mockResolvedValue(rows),
  })),
  filter: mock(() => ({
    collect: mock().mockResolvedValue(rows),
  })),
});

const buildLegacyAnalyticsDb = ({
  dailyByKey = null,
  dailyByUser = [],
  legacyRows,
  totals = null,
}: {
  dailyByKey?: any;
  dailyByUser?: any[];
  legacyRows: any[];
  totals?: any;
}) => ({
  insert: mock().mockResolvedValue("analytics_row"),
  patch: mock().mockResolvedValue(null),
  query: mock((table: string) => {
    if (table === "legacyApiKeyUsageDaily") {
      return {
        withIndex: mock((indexName: string) => {
          if (indexName === "by_legacy_key_and_date") {
            return { first: mock().mockResolvedValue(dailyByKey) };
          }
          if (indexName === "by_user_and_date") {
            return { take: mock().mockResolvedValue(dailyByUser) };
          }
          return {
            order: mock(() => ({ take: mock().mockResolvedValue([]) })),
          };
        }),
      };
    }
    if (table === "legacyApiKeyUsageTotalsDaily") {
      return {
        withIndex: mock(() => ({
          first: mock().mockResolvedValue(totals),
        })),
      };
    }
    return buildLegacyQuery(legacyRows);
  }),
});

const buildAuth = (subject = "user_1") => ({
  getUserIdentity: mock().mockResolvedValue({ subject }),
});

describe("apiKeys", () => {
  test("create stores new keys in the component", async () => {
    const key = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const ctx = {
      auth: buildAuth(),
      runMutation: mock().mockResolvedValue({
        key,
        keyId: "component_key",
      }),
    };

    const result = await runHandler(createUserApiKey, ctx, {
      name: "SDK Key",
    });

    expect(result).toEqual({
      access: "full_access",
      createdAt: expect.any(Number),
      id: "component_key",
      key,
      keyPrefix: "a1b2c3d4",
      name: "SDK Key",
      source: "component",
      status: "active",
    });
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        env: "live",
        name: "SDK Key",
        ownerId: "user_1",
        scopes: ["full_access"],
        type: "secret",
      })
    );
  });

  test("list returns component keys and legacy keys marked for update", async () => {
    const legacyKey = {
      _id: "legacy_key",
      access: "full_access",
      createdAt: 100,
      keyPrefix: "abc123",
      lastUsedAt: 150,
      name: "Old Key",
      revokedAt: undefined,
      updatedAt: 200,
      userId: "user_1",
    };
    const ctx = {
      auth: buildAuth(),
      db: {
        query: mock(() => buildLegacyQuery([legacyKey])),
      },
      runQuery: mock().mockResolvedValue([componentKey]),
    };

    const result = await runHandler(listUserApiKeys, ctx, {});

    expect(result).toEqual([
      expect.objectContaining({
        id: "component_key",
        maskedKey: `teakapi_secret_live_a1b2c3d4_••••••••`,
        requiresUpdate: false,
        source: "component",
      }),
      expect.objectContaining({
        id: "legacy_key",
        maskedKey: "abc123••••••••",
        requiresUpdate: true,
        source: "legacy",
      }),
    ]);
  });

  test("revoke marks legacy keys as revoked", async () => {
    const ctx = {
      auth: buildAuth(),
      db: {
        get: mock().mockResolvedValue({
          _id: "legacy_key",
          userId: "user_1",
        }),
        patch: mock().mockResolvedValue(null),
      },
    };

    await runHandler(revokeUserApiKey, ctx, {
      keyId: "legacy_key",
      source: "legacy",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "legacy_key",
      expect.objectContaining({ revokedAt: expect.any(Number) })
    );
  });

  test("revoke component keys through the component", async () => {
    const ctx = {
      auth: buildAuth(),
      runMutation: mock().mockResolvedValue(null),
    };

    await runHandler(revokeUserApiKey, ctx, {
      keyId: "component_key",
      source: "component",
    });

    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(ctx.runMutation.mock.calls.map((call) => call[1])).toEqual([
      { keyId: "component_key", ownerId: "user_1" },
    ]);
  });

  test("rotate creates a replacement key and immediately revokes the old component key", async () => {
    const newKey = `teakapi_secret_live_e5f6a7b8_${"a".repeat(64)}`;
    const ctx = {
      auth: buildAuth(),
      runMutation: mock()
        .mockResolvedValueOnce({
          key: newKey,
          keyId: "new_component_key",
        })
        .mockResolvedValueOnce(null),
      runQuery: mock().mockResolvedValue([componentKey]),
    };

    const result = await runHandler(rotateUserApiKey, ctx, {
      keyId: "component_key",
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: "new_component_key",
        key: newKey,
        keyPrefix: "e5f6a7b8",
        source: "component",
      })
    );
    expect(ctx.runMutation.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        env: "live",
        name: "SDK Key",
        ownerId: "user_1",
        scopes: ["full_access"],
      })
    );
    expect(ctx.runMutation.mock.calls[1][1]).toEqual({
      keyId: "component_key",
      ownerId: "user_1",
    });
  });

  test("rotate rejects exhausted component keys on the server", async () => {
    const ctx = {
      auth: buildAuth(),
      runMutation: mock(),
      runQuery: mock().mockResolvedValue([
        {
          ...componentKey,
          status: "exhausted",
        },
      ]),
    };

    await expect(
      runHandler(rotateUserApiKey, ctx, {
        keyId: "component_key",
      })
    ).rejects.toThrow("API key cannot be regenerated");

    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  test("validate accepts component keys and maps them to Teak authorization", async () => {
    const token = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const ctx = {
      runMutation: mock().mockResolvedValue({
        env: "live",
        keyId: "component_key",
        ownerId: "user_1",
        scopes: ["full_access"],
        tags: [],
        type: "secret",
        valid: true,
      }),
      runQuery: mock().mockResolvedValue({ _id: "user_1" }),
    };

    const result = await runHandler(validateUserApiKey, ctx, { token });

    expect(result).toEqual({
      access: "full_access",
      keyId: "component_key",
      rateLimitKey: "component:component_key",
      source: "component",
      userId: "user_1",
    });
  });

  test("validate preserves legacy key compatibility", async () => {
    const token = "teakapi_abc123_secretvalue";
    const insertedPayload = {
      access: "full_access",
      createdAt: 100,
      keyHash: await hashLegacyApiKey(token),
      keyPrefix: "abc123",
      lastUsedAt: undefined,
      name: "Old Key",
      revokedAt: undefined,
      updatedAt: 100,
      userId: "user_1",
    };
    const db = buildLegacyAnalyticsDb({
      legacyRows: [
        {
          _id: "legacy_key",
          ...insertedPayload,
        },
      ],
    });
    const ctx = {
      db,
      runQuery: mock().mockResolvedValue({ _id: "user_1" }),
    };

    const result = await runHandler(validateUserApiKey, ctx, {
      token,
    });

    expect(result).toEqual({
      access: "full_access",
      keyId: "legacy_key",
      rateLimitKey: "legacy:legacy_key",
      source: "legacy",
      userId: "user_1",
    });
    expect(db.patch).toHaveBeenCalledWith(
      "legacy_key",
      expect.objectContaining({ lastUsedAt: expect.any(Number) })
    );
    expect(db.insert).toHaveBeenCalledWith(
      "legacyApiKeyUsageDaily",
      expect.objectContaining({
        date: expect.any(String),
        keyPrefix: "abc123",
        legacyKeyId: "legacy_key",
        observedUseCount: 1,
        userId: "user_1",
      })
    );
    expect(db.insert).toHaveBeenCalledWith(
      "legacyApiKeyUsageTotalsDaily",
      expect.objectContaining({
        observedUseCount: 1,
        uniqueKeyCount: 1,
        uniqueUserCount: 1,
      })
    );
  });

  test("legacy usage analytics includes normalized request context", async () => {
    const token = "teakapi_abc123_secretvalue";
    const db = buildLegacyAnalyticsDb({
      legacyRows: [
        {
          _id: "legacy_key",
          access: "full_access",
          keyHash: await hashLegacyApiKey(token),
          keyPrefix: "abc123",
          lastUsedAt: undefined,
          revokedAt: undefined,
          userId: "user_1",
        },
      ],
    });
    const ctx = {
      db,
      runQuery: mock().mockResolvedValue({ _id: "user_1" }),
    };

    await runHandler(validateUserApiKey, ctx, {
      endpoint: "/v1/cards/:cardId/favorite",
      method: "PATCH",
      token,
    });

    expect(db.insert).toHaveBeenCalledWith(
      "legacyApiKeyUsageDaily",
      expect.objectContaining({
        lastEndpoint: "/v1/cards/:cardId/favorite",
        lastMethod: "PATCH",
      })
    );
  });

  test("legacy usage analytics is skipped inside the throttle window", async () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);
    const originalDateNow = Date.now;
    Date.now = () => now;
    try {
      const token = "teakapi_abc123_secretvalue";
      const db = buildLegacyAnalyticsDb({
        legacyRows: [
          {
            _id: "legacy_key",
            access: "full_access",
            keyHash: await hashLegacyApiKey(token),
            keyPrefix: "abc123",
            lastUsedAt: now - 1000,
            revokedAt: undefined,
            userId: "user_1",
          },
        ],
      });
      const ctx = {
        db,
        runQuery: mock().mockResolvedValue({ _id: "user_1" }),
      };

      const result = await runHandler(validateUserApiKey, ctx, { token });

      expect(result?.source).toBe("legacy");
      expect(db.patch).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.query.mock.calls.map((call) => call[0])).toEqual(["apiKeys"]);
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("legacy usage analytics records a new UTC day inside the throttle window", async () => {
    const now = Date.UTC(2026, 0, 2, 0, 1, 0);
    const originalDateNow = Date.now;
    Date.now = () => now;
    try {
      const token = "teakapi_abc123_secretvalue";
      const db = buildLegacyAnalyticsDb({
        legacyRows: [
          {
            _id: "legacy_key",
            access: "full_access",
            keyHash: await hashLegacyApiKey(token),
            keyPrefix: "abc123",
            lastUsedAt: Date.UTC(2026, 0, 1, 23, 59, 0),
            revokedAt: undefined,
            userId: "user_1",
          },
        ],
      });
      const ctx = {
        db,
        runQuery: mock().mockResolvedValue({ _id: "user_1" }),
      };

      await runHandler(validateUserApiKey, ctx, { token });

      expect(db.insert).toHaveBeenCalledWith(
        "legacyApiKeyUsageDaily",
        expect.objectContaining({ date: "2026-01-02" })
      );
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("legacy usage analytics counts a second key without double-counting the user", async () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);
    const originalDateNow = Date.now;
    Date.now = () => now;
    try {
      const token = "teakapi_abc123_secretvalue";
      const db = buildLegacyAnalyticsDb({
        dailyByUser: [{ _id: "existing_user_daily" }],
        legacyRows: [
          {
            _id: "legacy_key_2",
            access: "full_access",
            keyHash: await hashLegacyApiKey(token),
            keyPrefix: "abc123",
            lastUsedAt: now - 60 * 60 * 1000,
            revokedAt: undefined,
            userId: "user_1",
          },
        ],
        totals: {
          _id: "totals_2026_01_02",
          date: "2026-01-02",
          firstUsedAt: now - 10_000,
          lastUsedAt: now - 10_000,
          observedUseCount: 3,
          uniqueKeyCount: 1,
          uniqueUserCount: 1,
          updatedAt: now - 10_000,
        },
      });
      const ctx = {
        db,
        runQuery: mock().mockResolvedValue({ _id: "user_1" }),
      };

      await runHandler(validateUserApiKey, ctx, { token });

      expect(db.patch).toHaveBeenCalledWith(
        "totals_2026_01_02",
        expect.objectContaining({
          observedUseCount: 4,
          uniqueKeyCount: 2,
          uniqueUserCount: 1,
        })
      );
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("validate rejects malformed keys without touching storage or components", async () => {
    const ctx = {
      db: {
        query: mock(),
      },
      runMutation: mock(),
      runQuery: mock(),
    };

    const result = await runHandler(validateUserApiKey, ctx, {
      token: "teakapi_bad",
    });

    expect(result).toBeNull();
    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  test("validate rejects unmatched legacy keys without analytics writes", async () => {
    const db = buildLegacyAnalyticsDb({ legacyRows: [] });
    const ctx = {
      db,
      runQuery: mock(),
    };

    const result = await runHandler(validateUserApiKey, ctx, {
      endpoint: "/v1/cards/search",
      method: "GET",
      token: "teakapi_missing_secret",
    });

    expect(result).toBeNull();
    expect(db.patch).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.query.mock.calls.map((call) => call[0])).toEqual(["apiKeys"]);
  });

  test("cutover helper only revokes legacy active keys", async () => {
    const activeKeys = [
      { _id: "legacy_1", revokedAt: undefined },
      { _id: "legacy_2", revokedAt: undefined },
    ];

    const ctx = {
      db: {
        patch: mock().mockResolvedValue(null),
        query: mock(() => buildLegacyQuery(activeKeys)),
      },
    };

    const result = await runHandler(
      revokeAllActiveApiKeysForPrefixCutover,
      ctx,
      {}
    );

    expect(result.revokedCount).toBe(2);
    expect(ctx.db.patch).toHaveBeenCalledTimes(2);
  });
});
