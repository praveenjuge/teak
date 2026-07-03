import { ApiKeys, type KeyMetadata } from "@vllnt/convex-api-keys";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import {
  API_KEY_TOKEN_PREFIX,
  getApiKeyFormat,
  isLegacyApiKey,
} from "./shared/apiKeyFormat";

const API_KEY_NAME_DEFAULT = "Default API key";
const API_KEY_NAME_LEGACY_DEFAULT = "API Keys";
const API_KEY_ACCESS = "full_access" as const;
const COMPONENT_ENV = "live";
const COMPONENT_SCOPES = [API_KEY_ACCESS];
const LIST_LIMIT = 100;
// Only refresh legacy `lastUsedAt` when the recorded value is older than this
// window, preserving the low-contention behavior existing production keys had.
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

const componentApiKeys = new ApiKeys(components.apiKeys, {
  defaultType: "secret",
  prefix: API_KEY_TOKEN_PREFIX,
});

const apiKeyAccessValidator = v.literal(API_KEY_ACCESS);
const apiKeySourceValidator = v.union(
  v.literal("component"),
  v.literal("legacy")
);
const apiKeyStatusValidator = v.union(
  v.literal("active"),
  v.literal("disabled"),
  v.literal("rotating"),
  v.literal("expired"),
  v.literal("exhausted")
);

const listedApiKeyValidator = v.object({
  id: v.string(),
  name: v.string(),
  keyPrefix: v.string(),
  maskedKey: v.string(),
  access: apiKeyAccessValidator,
  source: apiKeySourceValidator,
  status: apiKeyStatusValidator,
  requiresUpdate: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastUsedAt: v.optional(v.number()),
});

const createdApiKeyValidator = v.object({
  id: v.string(),
  name: v.string(),
  keyPrefix: v.string(),
  key: v.string(),
  access: apiKeyAccessValidator,
  source: v.literal("component"),
  status: v.literal("active"),
  createdAt: v.number(),
});

const validatedApiKeyValidator = v.union(
  v.object({
    keyId: v.string(),
    userId: v.string(),
    access: apiKeyAccessValidator,
    source: apiKeySourceValidator,
    rateLimitKey: v.string(),
  }),
  v.null()
);

const revokeAllApiKeysResultValidator = v.object({
  revokedCount: v.number(),
  revokedAt: v.number(),
});

const componentKeyActionValidator = v.object({
  keyId: v.string(),
});

const validateApiKeyArgsValidator = v.object({
  token: v.string(),
  method: v.optional(v.string()),
  endpoint: v.optional(v.string()),
});

const revokeKeyArgsValidator = v.object({
  keyId: v.string(),
  source: apiKeySourceValidator,
});

interface LegacyUsageContext {
  endpoint?: string;
  method?: string;
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const hashApiKey = async (key: string): Promise<string> => {
  const pepper = process.env.BETTER_AUTH_SECRET ?? "";
  const payload = `${key}:${pepper}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload)
  );
  return toHex(new Uint8Array(digest));
};

const timingSafeEqual = (left: string, right: string): boolean => {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length === right.length ? 0 : 1;

  for (let i = 0; i < maxLength; i++) {
    const leftCode = left.charCodeAt(i) || 0;
    const rightCode = right.charCodeAt(i) || 0;
    mismatch |= leftCode ^ rightCode;
  }

  return mismatch === 0;
};

const getAuthUserById = async (ctx: MutationCtx, userId: string) =>
  ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", operator: "eq", value: userId }],
  });

const getAuthenticatedOwnerId = async (
  ctx: QueryCtx | MutationCtx
): Promise<string> => {
  const user = await ctx.auth.getUserIdentity();
  if (!user) {
    throw new Error("User must be authenticated");
  }
  return user.subject;
};

const getComponentKeysForOwner = async (
  ctx: QueryCtx,
  ownerId: string
): Promise<KeyMetadata[]> => {
  const keys = await componentApiKeys.list(ctx, {
    ownerId,
    limit: LIST_LIMIT,
  });

  return keys.filter((key) => key.status !== "revoked");
};

const normalizeApiKeyName = (name: string) =>
  name === API_KEY_NAME_LEGACY_DEFAULT ? API_KEY_NAME_DEFAULT : name;

const getUtcDate = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 10);

const normalizeUsageDimension = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
};

const mapComponentKey = (key: KeyMetadata) => ({
  id: key.keyId,
  name: normalizeApiKeyName(key.name),
  keyPrefix: key.lookupPrefix,
  maskedKey: `${API_KEY_TOKEN_PREFIX}_${key.type === "publishable" ? "pub" : "secret"}_${key.env}_${key.lookupPrefix}_••••••••`,
  access: API_KEY_ACCESS,
  source: "component" as const,
  status:
    key.status === "revoked" ? ("expired" as const) : key.status,
  requiresUpdate: false,
  createdAt: key.createdAt,
  updatedAt: key.createdAt,
  lastUsedAt: key.lastUsedAt,
});

const getComponentKeyForOwner = async (
  ctx: QueryCtx,
  ownerId: string,
  keyId: string
): Promise<KeyMetadata> => {
  const key = (await getComponentKeysForOwner(ctx, ownerId)).find(
    (candidate) => candidate.keyId === keyId
  );
  if (!key) {
    throw new Error("API key not found");
  }
  return key;
};

const isRotatableComponentKeyStatus = (status: KeyMetadata["status"]) =>
  status === "active" || status === "disabled";

const validateComponentApiKey = async (
  ctx: MutationCtx,
  token: string
) => {
  const result = await componentApiKeys.validate(ctx, { key: token });
  if (!result.valid) {
    return null;
  }

  if (
    result.type !== "secret" ||
    result.env !== COMPONENT_ENV ||
    !result.scopes.includes(API_KEY_ACCESS)
  ) {
    return null;
  }

  const authUser = await getAuthUserById(ctx, result.ownerId);
  if (!authUser) {
    await componentApiKeys.revoke(ctx, {
      keyId: result.keyId,
      ownerId: result.ownerId,
    });
    return null;
  }

  return {
    keyId: result.keyId,
    userId: result.ownerId,
    access: API_KEY_ACCESS,
    source: "component" as const,
    rateLimitKey: `component:${result.keyId}`,
  };
};

const validateLegacyApiKey = async (
  ctx: MutationCtx,
  token: string,
  usage?: LegacyUsageContext
) => {
  const parts = token.split("_");
  const keyPrefix = parts[1];
  if (!keyPrefix) {
    return null;
  }

  const candidates = await ctx.db
    .query("apiKeys")
    .withIndex("by_prefix_revoked", (q) =>
      q.eq("keyPrefix", keyPrefix).eq("revokedAt", undefined)
    )
    .take(LIST_LIMIT);

  if (candidates.length === 0) {
    return null;
  }

  const tokenHash = await hashApiKey(token);

  for (const candidate of candidates) {
    if (!timingSafeEqual(candidate.keyHash, tokenHash)) {
      continue;
    }

    const now = Date.now();
    const authUser = await getAuthUserById(ctx, candidate.userId);
    if (!authUser) {
      await ctx.db.patch(candidate._id, {
        revokedAt: now,
        updatedAt: now,
      });
      continue;
    }

    const lastUsedAt = candidate.lastUsedAt;
    const currentDate = getUtcDate(now);
    const lastUsedDate =
      lastUsedAt === undefined ? null : getUtcDate(lastUsedAt);
    const shouldTrackUsage =
      lastUsedAt === undefined ||
      now - lastUsedAt >= LAST_USED_THROTTLE_MS ||
      lastUsedDate !== currentDate;

    if (shouldTrackUsage) {
      await ctx.db.patch(candidate._id, {
        lastUsedAt: now,
        updatedAt: now,
      });
      await trackLegacyApiKeyUsage(ctx, {
        date: currentDate,
        endpoint: normalizeUsageDimension(usage?.endpoint),
        keyPrefix: candidate.keyPrefix,
        legacyKeyId: candidate._id,
        method: normalizeUsageDimension(usage?.method),
        now,
        userId: candidate.userId,
      });
    }

    return {
      keyId: candidate._id,
      userId: candidate.userId,
      access: candidate.access,
      source: "legacy" as const,
      rateLimitKey: `legacy:${candidate._id}`,
    };
  }

  return null;
};

const trackLegacyApiKeyUsage = async (
  ctx: MutationCtx,
  args: {
    date: string;
    endpoint?: string;
    keyPrefix: string;
    legacyKeyId: Id<"apiKeys">;
    method?: string;
    now: number;
    userId: string;
  }
) => {
  const existingDaily = await ctx.db
    .query("legacyApiKeyUsageDaily")
    .withIndex("by_legacy_key_and_date", (q) =>
      q.eq("legacyKeyId", args.legacyKeyId).eq("date", args.date)
    )
    .first();

  if (existingDaily) {
    await ctx.db.patch(existingDaily._id, {
      observedUseCount: existingDaily.observedUseCount + 1,
      lastUsedAt: args.now,
      ...(args.method ? { lastMethod: args.method } : {}),
      ...(args.endpoint ? { lastEndpoint: args.endpoint } : {}),
      updatedAt: args.now,
    });
    await updateLegacyApiKeyUsageTotals(ctx, args, {
      uniqueKeyIncrement: 0,
      uniqueUserIncrement: 0,
    });
    return;
  }

  const existingUserDaily = await ctx.db
    .query("legacyApiKeyUsageDaily")
    .withIndex("by_user_and_date", (q) =>
      q.eq("userId", args.userId).eq("date", args.date)
    )
    .take(1);

  await ctx.db.insert("legacyApiKeyUsageDaily", {
    date: args.date,
    legacyKeyId: args.legacyKeyId,
    userId: args.userId,
    keyPrefix: args.keyPrefix,
    observedUseCount: 1,
    firstUsedAt: args.now,
    lastUsedAt: args.now,
    ...(args.method ? { lastMethod: args.method } : {}),
    ...(args.endpoint ? { lastEndpoint: args.endpoint } : {}),
    updatedAt: args.now,
  });

  await updateLegacyApiKeyUsageTotals(ctx, args, {
    uniqueKeyIncrement: 1,
    uniqueUserIncrement: existingUserDaily.length === 0 ? 1 : 0,
  });
};

const updateLegacyApiKeyUsageTotals = async (
  ctx: MutationCtx,
  args: {
    date: string;
    now: number;
  },
  increments: {
    uniqueKeyIncrement: number;
    uniqueUserIncrement: number;
  }
) => {
  const existingTotals = await ctx.db
    .query("legacyApiKeyUsageTotalsDaily")
    .withIndex("by_date", (q) => q.eq("date", args.date))
    .first();

  if (existingTotals) {
    await ctx.db.patch(existingTotals._id, {
      observedUseCount: existingTotals.observedUseCount + 1,
      uniqueKeyCount:
        existingTotals.uniqueKeyCount + increments.uniqueKeyIncrement,
      uniqueUserCount:
        existingTotals.uniqueUserCount + increments.uniqueUserIncrement,
      lastUsedAt: args.now,
      updatedAt: args.now,
    });
    return;
  }

  await ctx.db.insert("legacyApiKeyUsageTotalsDaily", {
    date: args.date,
    observedUseCount: 1,
    uniqueKeyCount: increments.uniqueKeyIncrement,
    uniqueUserCount: increments.uniqueUserIncrement,
    firstUsedAt: args.now,
    lastUsedAt: args.now,
    updatedAt: args.now,
  });
};

export const createUserApiKey = mutation({
  args: {
    name: v.optional(v.string()),
  },
  returns: createdApiKeyValidator,
  handler: async (ctx, args) => {
    const ownerId = await getAuthenticatedOwnerId(ctx);
    const name = normalizeApiKeyName(args.name?.trim() || API_KEY_NAME_DEFAULT);
    const created = await componentApiKeys.create(ctx, {
      env: COMPONENT_ENV,
      name,
      ownerId,
      scopes: COMPONENT_SCOPES,
      type: "secret",
    });

    const [, , , lookupPrefix] = created.key.split("_");
    return {
      id: created.keyId,
      name,
      keyPrefix: lookupPrefix ?? "",
      key: created.key,
      access: API_KEY_ACCESS,
      source: "component" as const,
      status: "active" as const,
      createdAt: Date.now(),
    };
  },
});

export const listUserApiKeys = query({
  args: {},
  returns: v.array(listedApiKeyValidator),
  handler: async (ctx) => {
    let ownerId: string;
    try {
      ownerId = await getAuthenticatedOwnerId(ctx);
    } catch {
      return [];
    }

    const [componentKeys, legacyKeys] = await Promise.all([
      getComponentKeysForOwner(ctx, ownerId),
      ctx.db
        .query("apiKeys")
        .withIndex("by_user_revoked", (q) =>
          q.eq("userId", ownerId).eq("revokedAt", undefined)
        )
        .order("desc")
        .take(LIST_LIMIT),
    ]);

    return [
      ...componentKeys.map(mapComponentKey),
      ...legacyKeys.map((key) => ({
        id: key._id,
        name: normalizeApiKeyName(key.name),
        keyPrefix: key.keyPrefix,
        maskedKey: `${key.keyPrefix}••••••••`,
        access: key.access,
        source: "legacy" as const,
        status: "active" as const,
        requiresUpdate: true,
        createdAt: key.createdAt,
        updatedAt: key.updatedAt,
        lastUsedAt: key.lastUsedAt,
      })),
    ].sort((left, right) => right.createdAt - left.createdAt);
  },
});

export const revokeUserApiKey = mutation({
  args: revokeKeyArgsValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await getAuthenticatedOwnerId(ctx);

    if (args.source === "component") {
      await componentApiKeys.revoke(ctx, {
        keyId: args.keyId,
        ownerId,
      });
      return null;
    }

    const legacyKeyId = args.keyId as Id<"apiKeys">;
    const key = await ctx.db.get(legacyKeyId);
    if (!key || key.userId !== ownerId) {
      throw new Error("API key not found");
    }

    const now = Date.now();
    await ctx.db.patch(legacyKeyId, {
      revokedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const rotateUserApiKey = mutation({
  args: componentKeyActionValidator,
  returns: createdApiKeyValidator,
  handler: async (ctx, args) => {
    const ownerId = await getAuthenticatedOwnerId(ctx);
    const existing = await getComponentKeyForOwner(ctx, ownerId, args.keyId);
    if (!isRotatableComponentKeyStatus(existing.status)) {
      throw new Error("API key cannot be regenerated");
    }

    const name = normalizeApiKeyName(existing.name);
    const created = await componentApiKeys.create(ctx, {
      env: COMPONENT_ENV,
      name,
      ownerId,
      scopes: COMPONENT_SCOPES,
      type: "secret",
    });
    await componentApiKeys.revoke(ctx, {
      keyId: args.keyId,
      ownerId,
    });

    const [, , , lookupPrefix] = created.key.split("_");
    return {
      id: created.keyId,
      name,
      keyPrefix: lookupPrefix ?? "",
      key: created.key,
      access: API_KEY_ACCESS,
      source: "component" as const,
      status: "active" as const,
      createdAt: Date.now(),
    };
  },
});

export const validateUserApiKey = internalMutation({
  args: validateApiKeyArgsValidator,
  returns: validatedApiKeyValidator,
  handler: async (ctx, args) => {
    const token = args.token.trim();
    const format = getApiKeyFormat(token);
    if (format === "malformed") {
      return null;
    }

    if (format === "component") {
      return validateComponentApiKey(ctx, token);
    }

    if (isLegacyApiKey(token)) {
      return validateLegacyApiKey(ctx, token, {
        endpoint: args.endpoint,
        method: args.method,
      });
    }

    return null;
  },
});

// Historical one-time helper retained for old tests/manual cleanup. New
// component-managed keys are intentionally unaffected by this legacy mutation.
export const revokeAllActiveApiKeysForPrefixCutover = internalMutation({
  args: {},
  returns: revokeAllApiKeysResultValidator,
  handler: async (ctx) => {
    const now = Date.now();
    const activeKeys = await ctx.db
      .query("apiKeys")
      .filter((q) => q.eq(q.field("revokedAt"), undefined))
      .collect();

    for (const key of activeKeys) {
      await ctx.db.patch(key._id, {
        revokedAt: now,
        updatedAt: now,
      });
    }

    return {
      revokedCount: activeKeys.length,
      revokedAt: now,
    };
  },
});

// TEMPORARY one-time purge of all legacy API key data: the homegrown
// `apiKeys` table plus its `legacyApiKeyUsageDaily` /
// `legacyApiKeyUsageTotalsDaily` analytics tables. Deleted in the follow-up
// commit once the local and prod deployments have been cleared. Deletes in
// bounded batches to stay within Convex transaction limits and reschedules
// itself until every table is drained. Idempotent: re-running after
// completion is a no-op that returns all zeros.
const LEGACY_PURGE_BATCH_SIZE = 200;

export const purgeLegacyApiKeyData = internalMutation({
  args: {},
  returns: v.object({
    apiKeys: v.number(),
    legacyApiKeyUsageDaily: v.number(),
    legacyApiKeyUsageTotalsDaily: v.number(),
    rescheduled: v.boolean(),
  }),
  handler: async (
    ctx
  ): Promise<{
    apiKeys: number;
    legacyApiKeyUsageDaily: number;
    legacyApiKeyUsageTotalsDaily: number;
    rescheduled: boolean;
  }> => {
    const apiKeyRows = await ctx.db
      .query("apiKeys")
      .take(LEGACY_PURGE_BATCH_SIZE);
    for (const row of apiKeyRows) {
      await ctx.db.delete(row._id);
    }

    const usageDailyRows = await ctx.db
      .query("legacyApiKeyUsageDaily")
      .take(LEGACY_PURGE_BATCH_SIZE);
    for (const row of usageDailyRows) {
      await ctx.db.delete(row._id);
    }

    const usageTotalsRows = await ctx.db
      .query("legacyApiKeyUsageTotalsDaily")
      .take(LEGACY_PURGE_BATCH_SIZE);
    for (const row of usageTotalsRows) {
      await ctx.db.delete(row._id);
    }

    // If any table returned a full batch there may be more rows; reschedule to
    // continue in a fresh transaction rather than exceeding the write limit.
    const rescheduled =
      apiKeyRows.length === LEGACY_PURGE_BATCH_SIZE ||
      usageDailyRows.length === LEGACY_PURGE_BATCH_SIZE ||
      usageTotalsRows.length === LEGACY_PURGE_BATCH_SIZE;

    if (rescheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.apiKeys.purgeLegacyApiKeyData,
        {}
      );
    }

    return {
      apiKeys: apiKeyRows.length,
      legacyApiKeyUsageDaily: usageDailyRows.length,
      legacyApiKeyUsageTotalsDaily: usageTotalsRows.length,
      rescheduled,
    };
  },
});
