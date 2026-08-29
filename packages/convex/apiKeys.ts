import { ApiKeys, type KeyMetadata } from "@vllnt/convex-api-keys";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { API_KEY_TOKEN_PREFIX, getApiKeyFormat } from "./shared/apiKeyFormat";
import { rateLimiter } from "./shared/rateLimits";

const API_KEY_NAME_DEFAULT = "Default API key";
// Component keys minted before the rename may still carry the old default
// name; normalize it on read so the UI shows the current label.
const API_KEY_NAME_LEGACY_DEFAULT = "API Keys";
const API_KEY_ACCESS = "full_access" as const;
const COMPONENT_ENV = "live";
const COMPONENT_SCOPES = [API_KEY_ACCESS];
const LIST_LIMIT = 100;
const MAX_ACTIVE_KEYS_PER_OWNER = 10;
const LIVE_KEY_STATUSES = [
  "active",
  "disabled",
  "rotating",
  "expired",
  "exhausted",
] as const;

const componentApiKeys = new ApiKeys(components.apiKeys, {
  defaultType: "secret",
  prefix: API_KEY_TOKEN_PREFIX,
});

const apiKeyAccessValidator = v.literal(API_KEY_ACCESS);
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
  status: apiKeyStatusValidator,
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
    rateLimitKey: v.string(),
  }),
  v.null()
);

const componentKeyActionValidator = v.object({
  keyId: v.string(),
});

const validateApiKeyArgsValidator = v.object({
  token: v.string(),
});

const revokeKeyArgsValidator = v.object({
  keyId: v.string(),
  // `source` is unused now that component keys are the only path. It stays as an
  // optional, ignored string so API clients deployed before this change (which
  // still send it during the rollout window) are not rejected for an unknown
  // argument. Safe to remove once those clients have rolled over.
  source: v.optional(v.string()),
});

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

const listComponentKeysByStatus = async (
  ctx: QueryCtx | MutationCtx,
  ownerId: string,
  status: (typeof LIVE_KEY_STATUSES)[number]
): Promise<KeyMetadata[]> =>
  componentApiKeys.list(ctx, {
    ownerId,
    limit: LIST_LIMIT,
    status,
  });

const countActiveKeysForOwner = async (
  ctx: QueryCtx | MutationCtx,
  ownerId: string
): Promise<number> =>
  (await listComponentKeysByStatus(ctx, ownerId, "active")).length;

const getComponentKeysForOwner = async (
  ctx: QueryCtx | MutationCtx,
  ownerId: string
): Promise<KeyMetadata[]> => {
  const pages = await Promise.all(
    LIVE_KEY_STATUSES.map((status) =>
      listComponentKeysByStatus(ctx, ownerId, status)
    )
  );
  return pages.flat();
};

const normalizeApiKeyName = (name: string) =>
  name === API_KEY_NAME_LEGACY_DEFAULT ? API_KEY_NAME_DEFAULT : name;

const mapComponentKey = (key: KeyMetadata) => ({
  id: key.keyId,
  name: normalizeApiKeyName(key.name),
  keyPrefix: key.lookupPrefix,
  maskedKey: `${API_KEY_TOKEN_PREFIX}_${key.type === "publishable" ? "pub" : "secret"}_${key.env}_${key.lookupPrefix}_••••••••`,
  access: API_KEY_ACCESS,
  status: key.status === "revoked" ? ("expired" as const) : key.status,
  createdAt: key.createdAt,
  updatedAt: key.createdAt,
  lastUsedAt: key.lastUsedAt,
});

const getComponentKeyForOwner = async (
  ctx: QueryCtx | MutationCtx,
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

const validateComponentApiKey = async (ctx: MutationCtx, token: string) => {
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
    rateLimitKey: `component:${result.keyId}`,
  };
};

export const createUserApiKey = mutation({
  args: {
    name: v.optional(v.string()),
  },
  returns: createdApiKeyValidator,
  handler: async (ctx, args) => {
    const ownerId = await getAuthenticatedOwnerId(ctx);
    const rateLimitResult = await rateLimiter.limit(ctx, "apiKeyCreation", {
      key: ownerId,
      throws: false,
    });
    if (!rateLimitResult.ok) {
      throw new Error("Too many API keys created. Try again in a minute.");
    }
    if (
      (await countActiveKeysForOwner(ctx, ownerId)) >= MAX_ACTIVE_KEYS_PER_OWNER
    ) {
      throw new Error(
        "Active API key limit reached. Revoke unused keys first."
      );
    }
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

    const componentKeys = await getComponentKeysForOwner(ctx, ownerId);
    return componentKeys
      .map(mapComponentKey)
      .sort((left, right) => right.createdAt - left.createdAt);
  },
});

export const revokeUserApiKey = mutation({
  args: revokeKeyArgsValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await getAuthenticatedOwnerId(ctx);
    await componentApiKeys.revoke(ctx, {
      keyId: args.keyId,
      ownerId,
    });
    return null;
  },
});

const drainActiveApiKeysPage = async (
  ctx: MutationCtx,
  ownerId: string,
  revokedCount: number
): Promise<{ hasMore: boolean; revokedCount: number }> => {
  const keys = await listComponentKeysByStatus(ctx, ownerId, "active");
  for (const key of keys) {
    await componentApiKeys.revoke(ctx, {
      keyId: key.keyId,
      ownerId,
    });
  }

  const nextCount = revokedCount + keys.length;
  const hasMore = keys.length === LIST_LIMIT;
  if (hasMore) {
    await ctx.scheduler.runAfter(0, internal.apiKeys.revokeAllUserApiKeysPage, {
      ownerId,
      revokedCount: nextCount,
    });
  }

  return { hasMore, revokedCount: nextCount };
};

export const revokeAllUserApiKeysPage = internalMutation({
  args: {
    ownerId: v.string(),
    revokedCount: v.number(),
  },
  returns: v.object({
    hasMore: v.boolean(),
    revokedCount: v.number(),
  }),
  handler: async (ctx, args) =>
    drainActiveApiKeysPage(ctx, args.ownerId, args.revokedCount),
});

export const revokeAllUserApiKeys = mutation({
  args: {},
  returns: v.object({
    hasMore: v.boolean(),
    revokedCount: v.number(),
  }),
  handler: async (ctx) => {
    const ownerId = await getAuthenticatedOwnerId(ctx);
    return drainActiveApiKeysPage(ctx, ownerId, 0);
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
    if (getApiKeyFormat(token) !== "component") {
      return null;
    }

    const validated = await validateComponentApiKey(ctx, token);
    return validated;
  },
});
