import { v } from "convex/values";
import { components } from "./_generated/api";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  query,
} from "./_generated/server";

const API_KEY_NAME_DEFAULT = "Raycast Key";
const API_KEY_TOKEN_PREFIX = "teakrk";
const API_KEY_ACCESS = "full_access" as const;
const KEY_PREFIX_BYTES = 6;
const KEY_SECRET_BYTES = 24;

const apiKeyAccessValidator = v.literal(API_KEY_ACCESS);

const listedApiKeyValidator = v.object({
  id: v.id("apiKeys"),
  name: v.string(),
  keyPrefix: v.string(),
  maskedKey: v.string(),
  access: apiKeyAccessValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  lastUsedAt: v.optional(v.number()),
});

const createdApiKeyValidator = v.object({
  id: v.id("apiKeys"),
  name: v.string(),
  keyPrefix: v.string(),
  key: v.string(),
  access: apiKeyAccessValidator,
  createdAt: v.number(),
});

const validatedApiKeyValidator = v.union(
  v.object({
    keyId: v.id("apiKeys"),
    userId: v.string(),
    access: apiKeyAccessValidator,
  }),
  v.null()
);

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const createRandomHex = (size: number): string => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};

const buildApiKey = (): { key: string; keyPrefix: string } => {
  const keyPrefix = createRandomHex(KEY_PREFIX_BYTES);
  const secret = createRandomHex(KEY_SECRET_BYTES);
  const key = `${API_KEY_TOKEN_PREFIX}_${keyPrefix}_${secret}`;
  return { key, keyPrefix };
};

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

const revokeActiveKeysForUser = async (
  ctx: MutationCtx,
  userId: string,
  now: number
) => {
  const activeKeys = await ctx.db
    .query("apiKeys")
    .withIndex("by_user_revoked", (q) =>
      q.eq("userId", userId).eq("revokedAt", undefined)
    )
    .collect();

  for (const key of activeKeys) {
    await ctx.db.patch("apiKeys", key._id, {
      revokedAt: now,
      updatedAt: now,
    });
  }
};

const getAuthUserById = async (ctx: MutationCtx, userId: string) => {
  return ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", operator: "eq", value: userId }],
  });
};

export const createRaycastApiKey = mutation({
  args: {
    name: v.optional(v.string()),
  },
  returns: createdApiKeyValidator,
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const now = Date.now();
    await revokeActiveKeysForUser(ctx, user.subject, now);

    const { key, keyPrefix } = buildApiKey();
    const keyHash = await hashApiKey(key);
    const name = args.name?.trim() || API_KEY_NAME_DEFAULT;

    const keyId = await ctx.db.insert("apiKeys", {
      userId: user.subject,
      name,
      keyPrefix,
      keyHash,
      access: API_KEY_ACCESS,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: undefined,
      revokedAt: undefined,
    });

    return {
      id: keyId,
      name,
      keyPrefix,
      key,
      access: API_KEY_ACCESS,
      createdAt: now,
    };
  },
});

export const listRaycastApiKeys = query({
  args: {},
  returns: v.array(listedApiKeyValidator),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_user_revoked", (q) =>
        q.eq("userId", user.subject).eq("revokedAt", undefined)
      )
      .order("desc")
      .collect();

    return keys.map((key) => ({
      id: key._id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      maskedKey: `${key.keyPrefix}••••••••`,
      access: key.access,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      lastUsedAt: key.lastUsedAt,
    }));
  },
});

export const revokeRaycastApiKey = mutation({
  args: {
    keyId: v.optional(v.id("apiKeys")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const now = Date.now();

    if (args.keyId) {
      const key = await ctx.db.get("apiKeys", args.keyId);
      if (!key || key.userId !== user.subject) {
        throw new Error("API key not found");
      }
      await ctx.db.patch("apiKeys", args.keyId, {
        revokedAt: now,
        updatedAt: now,
      });
      return null;
    }

    await revokeActiveKeysForUser(ctx, user.subject, now);
    return null;
  },
});

export const validateRaycastApiKey = internalMutation({
  args: {
    token: v.string(),
  },
  returns: validatedApiKeyValidator,
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!token.startsWith(`${API_KEY_TOKEN_PREFIX}_`)) {
      return null;
    }

    const parts = token.split("_");
    if (parts.length !== 3) {
      return null;
    }

    const keyPrefix = parts[1];
    if (!keyPrefix) {
      return null;
    }

    const candidates = await ctx.db
      .query("apiKeys")
      .withIndex("by_prefix_revoked", (q) =>
        q.eq("keyPrefix", keyPrefix).eq("revokedAt", undefined)
      )
      .collect();

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
        await ctx.db.patch("apiKeys", candidate._id, {
          revokedAt: now,
          updatedAt: now,
        });
        continue;
      }

      await ctx.db.patch("apiKeys", candidate._id, {
        lastUsedAt: now,
        updatedAt: now,
      });

      return {
        keyId: candidate._id,
        userId: candidate.userId,
        access: candidate.access,
      };
    }

    return null;
  },
});
