// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  createUserApiKey,
  listUserApiKeys,
  revokeAllUserApiKeys,
  revokeAllUserApiKeysPage,
  revokeUserApiKey,
  rotateUserApiKey,
  validateUserApiKey,
} from "../apiKeys";
import { rateLimiter } from "../shared/rateLimits";

const runHandler = (fn: any, ctx: any, args: any) => {
  const handler = (fn as any).handler ?? fn;
  return handler(ctx, args);
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

const buildAuth = (subject = "user_1") => ({
  getUserIdentity: mock().mockResolvedValue({ subject }),
});

const listActiveKeys = (keys: unknown[]) =>
  mock().mockImplementation((_ref, args) => {
    if (args?.status && args.status !== "active") {
      return [];
    }
    return keys;
  });

describe("apiKeys", () => {
  beforeEach(() => {
    rateLimiter.limit = mock().mockResolvedValue({ ok: true });
  });

  test("create stores new keys in the component", async () => {
    const key = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
    const ctx = {
      auth: buildAuth(),
      runMutation: mock().mockResolvedValue({
        key,
        keyId: "component_key",
      }),
      runQuery: listActiveKeys([]),
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
    expect(ctx.runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerId: "user_1",
        status: "active",
      })
    );
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

  test("create refuses a hidden overflow of active keys", async () => {
    const ctx = {
      auth: buildAuth(),
      runMutation: mock(),
      runQuery: listActiveKeys(
        Array.from({ length: 10 }, (_, index) => ({
          ...componentKey,
          keyId: `key_${index}`,
        }))
      ),
    };

    await expect(runHandler(createUserApiKey, ctx, {})).rejects.toThrow(
      "Active API key limit reached"
    );
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  test("create rate-limits key minting", async () => {
    rateLimiter.limit = mock().mockResolvedValue({ ok: false, retryAfter: 1 });
    const ctx = {
      auth: buildAuth(),
      runMutation: mock(),
      runQuery: listActiveKeys([]),
    };

    await expect(runHandler(createUserApiKey, ctx, {})).rejects.toThrow(
      "Too many API keys created"
    );
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  test("list queries live statuses instead of filtering a truncated page", async () => {
    const ctx = {
      auth: buildAuth(),
      runQuery: listActiveKeys([componentKey]),
    };

    const result = await runHandler(listUserApiKeys, ctx, {});

    expect(result).toEqual([
      expect.objectContaining({
        id: "component_key",
        maskedKey: "teakapi_secret_live_a1b2c3d4_••••••••",
        status: "active",
      }),
    ]);
    expect(
      ctx.runQuery.mock.calls.some((call) => call[1]?.status === "active")
    ).toBe(true);
    expect(result[0]).not.toHaveProperty("source");
    expect(result[0]).not.toHaveProperty("requiresUpdate");
  });

  test("revoke component keys through the component", async () => {
    const ctx = {
      auth: buildAuth(),
      runMutation: mock().mockResolvedValue(null),
    };

    await runHandler(revokeUserApiKey, ctx, {
      keyId: "component_key",
    });

    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(ctx.runMutation.mock.calls.map((call) => call[1])).toEqual([
      { keyId: "component_key", ownerId: "user_1" },
    ]);
  });

  test("revoke-all drains an active page and schedules the next page", async () => {
    const keys = Array.from({ length: 100 }, (_, index) => ({
      ...componentKey,
      keyId: `key_${index}`,
    }));
    const ctx = {
      runMutation: mock().mockResolvedValue(null),
      runQuery: listActiveKeys(keys),
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    };

    const result = await runHandler(revokeAllUserApiKeysPage, ctx, {
      ownerId: "user_1",
      revokedCount: 0,
    });

    expect(result).toEqual({ hasMore: true, revokedCount: 100 });
    expect(ctx.runMutation).toHaveBeenCalledTimes(100);
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      ownerId: "user_1",
      revokedCount: 100,
    });
  });

  test("revoke-all public mutation authenticates then drains", async () => {
    const ctx = {
      auth: buildAuth(),
      runMutation: mock().mockResolvedValue(null),
      runQuery: listActiveKeys([
        componentKey,
        { ...componentKey, keyId: "component_key_2" },
      ]),
      scheduler: { runAfter: mock() },
    };

    const result = await runHandler(revokeAllUserApiKeys, ctx, {});

    expect(result).toEqual({ hasMore: false, revokedCount: 2 });
    expect(ctx.runMutation).toHaveBeenCalledTimes(2);
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
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
      runQuery: listActiveKeys([componentKey]),
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
      runQuery: mock().mockImplementation((_ref, args) => {
        if (args?.status === "exhausted") {
          return [
            {
              ...componentKey,
              status: "exhausted",
            },
          ];
        }
        return [];
      }),
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
      userId: "user_1",
    });
  });

  test("validate rejects malformed keys without touching the component", async () => {
    const ctx = {
      runMutation: mock(),
      runQuery: mock(),
    };

    const result = await runHandler(validateUserApiKey, ctx, {
      token: "teakapi_bad",
    });

    expect(result).toBeNull();
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  test("validate rejects a retired legacy-format token", async () => {
    const ctx = {
      runMutation: mock(),
      runQuery: mock(),
    };

    const result = await runHandler(validateUserApiKey, ctx, {
      token: "teakapi_abc12345_secret",
    });

    expect(result).toBeNull();
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });
});
