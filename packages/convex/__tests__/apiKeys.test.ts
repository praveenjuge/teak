// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";

import {
  createUserApiKey,
  listUserApiKeys,
  revokeUserApiKey,
  rotateUserApiKey,
  validateUserApiKey,
} from "../apiKeys";

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

  test("list returns only component keys", async () => {
    const ctx = {
      auth: buildAuth(),
      runQuery: mock().mockResolvedValue([componentKey]),
    };

    const result = await runHandler(listUserApiKeys, ctx, {});

    expect(result).toEqual([
      expect.objectContaining({
        id: "component_key",
        maskedKey: "teakapi_secret_live_a1b2c3d4_••••••••",
        status: "active",
      }),
    ]);
    // `source` and `requiresUpdate` are no longer surfaced now that legacy
    // keys are gone.
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
    // The old `teakapi_<prefix>_<secret>` shape is now malformed and must never
    // reach the component validator.
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
