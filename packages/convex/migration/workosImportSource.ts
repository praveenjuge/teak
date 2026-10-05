import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { readAuthPrimary, readSignupsDisabled } from "../env";
import type { BetterAuthUserSource } from "../userIdentityTable";
import { assertImportLease, importLeaseOwner } from "./workosImportLease";

const pins = { environmentId: v.string(), clientId: v.string() };
const ownerValidator = v.object({
  teakUserId: v.string(),
  email: v.string(),
  emailVerified: v.boolean(),
  name: v.union(v.string(), v.null()),
  passwordHash: v.union(v.string(), v.null()),
  changedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()),
  workosUserId: v.union(v.string(), v.null()),
  sourceVersion: v.string(),
});
function assertPins(args: { environmentId: string; clientId: string }) {
  if (
    args.environmentId !== process.env.WORKOS_ENVIRONMENT_ID ||
    args.clientId !== process.env.WORKOS_CLIENT_ID ||
    readAuthPrimary() !== "betterauth" ||
    !readSignupsDisabled()
  ) {
    throw new Error("Importer requires pinned frozen Better Auth deployment");
  }
}
async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
async function source(ctx: QueryCtx | MutationCtx, row: Doc<"users">) {
  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", value: row.teakUserId }],
  })) as (BetterAuthUserSource & { name?: string; updatedAt: number }) | null;
  if (!user && row.deletedAt === undefined) {
    throw new Error("Missing Better Auth source requires quarantine");
  }
  const accounts = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "account",
    where: [
      { field: "userId", value: row.teakUserId },
      { field: "providerId", value: "credential", connector: "AND" },
    ],
    paginationOpts: { cursor: null, numItems: 2 },
  });
  if (!accounts.isDone || accounts.page.length > 1) {
    throw new Error("Ambiguous credential source requires quarantine");
  }
  const credential = accounts.page[0] as
    | { password?: string; updatedAt?: number }
    | undefined;
  if (user && !Number.isFinite(user.updatedAt)) {
    throw new Error("Missing source update timestamp requires quarantine");
  }
  if (credential?.password && !Number.isFinite(credential.updatedAt)) {
    throw new Error("Missing credential update timestamp requires quarantine");
  }
  const owner = {
    teakUserId: row.teakUserId,
    email: user?.email ?? row.email,
    emailVerified: user ? user.emailVerified : row.emailVerified,
    name: user?.name ?? null,
    passwordHash: credential?.password ?? null,
    changedAt: Math.max(
      user?.updatedAt ?? 0,
      credential?.updatedAt ?? 0,
      row.deletedAt ?? 0
    ),
    deletedAt: row.deletedAt ?? null,
    workosUserId: row.workosUserId ?? null,
  };
  if (
    typeof owner.emailVerified !== "boolean" ||
    !Number.isFinite(owner.changedAt)
  ) {
    throw new Error("Invalid importer source; explicit verification required");
  }
  return { ...owner, sourceVersion: await digest(JSON.stringify(owner)) };
}
// Binds provider credentials before any source export or provider mutation.
export const admission = internalQuery({
  args: { ...pins, apiKeyFingerprint: v.string() },
  returns: v.object({ witnessUserId: v.string() }),
  handler: async (_ctx, args) => {
    assertPins(args);
    const key = process.env.WORKOS_API_KEY;
    const witnessUserId = process.env.WORKOS_RECONCILIATION_WITNESS_ID;
    if (
      !key ||
      (await digest(key)) !== args.apiKeyFingerprint ||
      !witnessUserId ||
      !/^user_[A-Za-z0-9]+$/.test(witnessUserId)
    ) {
      throw new Error("Missing or changed importer witness binding");
    }
    return { witnessUserId };
  },
});
export const page = internalQuery({
  args: {
    ...pins,
    apiKeyFingerprint: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    owners: v.array(ownerValidator),
    done: v.boolean(),
    cursor: v.union(v.string(), v.null()),
    unresolvedQuarantine: v.boolean(),
  }),
  handler: async (ctx, args) => {
    assertPins(args);
    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey || (await digest(apiKey)) !== args.apiKeyFingerprint) {
      throw new Error("Importer credential changed");
    }
    const unresolved = await ctx.db
      .query("migrationQuarantine")
      .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
      .first();
    if (unresolved) {
      return {
        owners: [],
        done: false,
        cursor: args.cursor,
        unresolvedQuarantine: true,
      };
    }
    const result = await ctx.db
      .query("users")
      .paginate({ cursor: args.cursor, numItems: 20 });
    const owners: Awaited<ReturnType<typeof source>>[] = [];
    for (const row of result.page) {
      const sameOwner = await ctx.db
        .query("users")
        .withIndex("by_teakUserId", (q) => q.eq("teakUserId", row.teakUserId))
        .take(2);
      const normalizedEmail = row.email.trim().toLowerCase();
      const sameEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
        .take(2);
      if (
        sameOwner.length !== 1 ||
        sameEmail.length !== 1 ||
        normalizedEmail !== row.email
      ) {
        throw new Error("Preflight identity collision requires quarantine");
      }
      owners.push(await source(ctx, row));
    }
    return {
      owners,
      done: result.isDone,
      cursor: result.isDone ? null : result.continueCursor,
      unresolvedQuarantine: false,
    };
  },
});
export const link = internalMutation({
  args: {
    ...pins,
    ...importLeaseOwner,
    teakUserId: v.string(),
    sourceVersion: v.string(),
    apiKeyFingerprint: v.string(),
    user: v.object({
      id: v.string(),
      externalId: v.union(v.string(), v.null()),
      email: v.string(),
      emailVerified: v.boolean(),
    }),
  },
  returns: v.union(v.literal("linked"), v.literal("quarantined")),
  handler: async (ctx, args) => {
    await assertImportLease(ctx, args);
    const row = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", args.teakUserId))
      .unique();
    if (
      !row ||
      row.deletedAt !== undefined ||
      args.user.externalId !== args.teakUserId
    ) {
      throw new Error("Importer owner changed");
    }
    if ((await source(ctx, row)).sourceVersion !== args.sourceVersion) {
      throw new Error("Importer source changed; resume with a fresh page");
    }
    const result = await ctx.runMutation(internal.workosUsers.linkWorkosUser, {
      workosUserId: args.user.id,
      externalId: args.user.externalId,
      email: args.user.email,
      emailVerified: args.user.emailVerified,
      source: "import",
    });
    return result.status;
  },
});

export const quarantine = internalMutation({
  args: {
    ...pins,
    ...importLeaseOwner,
    apiKeyFingerprint: v.string(),
    teakUserId: v.string(),
    sourceVersion: v.string(),
    workosUserId: v.union(v.string(), v.null()),
    reason: v.union(
      v.literal("external_id_mismatch"),
      v.literal("link_conflict"),
      v.literal("duplicate_email"),
      v.literal("missing_mapping")
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertImportLease(ctx, args);
    const row = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", args.teakUserId))
      .unique();
    if (!row || (await source(ctx, row)).sourceVersion !== args.sourceVersion) {
      throw new Error("Importer source changed");
    }
    await ctx.db.insert("migrationQuarantine", {
      teakUserId: row.teakUserId,
      ...(args.workosUserId ? { workosUserId: args.workosUserId } : {}),
      email: row.email,
      source: "import",
      reason: args.reason,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const preflightPage = internalQuery({
  args: {
    ...pins,
    apiKeyFingerprint: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    owners: v.array(
      v.object({
        teakUserId: v.string(),
        email: v.string(),
        workosUserId: v.union(v.string(), v.null()),
        deleted: v.boolean(),
        passwordFormat: v.union(
          v.literal("none"),
          v.literal("compatible"),
          v.literal("unsupported")
        ),
      })
    ),
    done: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    assertPins(args);
    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey || (await digest(apiKey)) !== args.apiKeyFingerprint) {
      throw new Error("Importer credential changed");
    }
    const result = await ctx.db
      .query("users")
      .paginate({ cursor: args.cursor, numItems: 20 });
    const owners: {
      teakUserId: string;
      email: string;
      workosUserId: string | null;
      deleted: boolean;
      passwordFormat: "none" | "compatible" | "unsupported";
    }[] = [];
    for (const row of result.page) {
      const current = await source(ctx, row);
      let passwordFormat: "none" | "compatible" | "unsupported" = "none";
      if (current.passwordHash) {
        passwordFormat = /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(
          current.passwordHash
        )
          ? "compatible"
          : "unsupported";
      }
      owners.push({
        teakUserId: row.teakUserId,
        email: current.email,
        workosUserId: row.workosUserId ?? null,
        deleted: row.deletedAt !== undefined,
        passwordFormat,
      });
    }
    return {
      owners,
      done: result.isDone,
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});

// The full collision report lives in the private operator artifact. Persist at
// most twenty fences: any unresolved receipt already denies all import pages.
export const quarantinePreflight = internalMutation({
  args: {
    ...pins,
    ...importLeaseOwner,
    apiKeyFingerprint: v.string(),
    receipts: v.array(
      v.object({
        email: v.string(),
        reason: v.union(
          v.literal("invalid_email"),
          v.literal("duplicate_email"),
          v.literal("duplicate_owner"),
          v.literal("duplicate_mapping"),
          v.literal("duplicate_provider_identity"),
          v.literal("duplicate_provider_email"),
          v.literal("invalid_provider_email"),
          v.literal("provider_email_collision"),
          v.literal("external_id_mismatch")
        ),
        teakUserId: v.optional(v.string()),
        workosUserId: v.optional(v.string()),
      })
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await assertImportLease(ctx, args);
    if (
      args.receipts.length === 0 ||
      args.receipts.length > 20 ||
      args.receipts.some(
        (receipt) =>
          receipt.email.length > 320 ||
          (receipt.teakUserId?.length ?? 0) > 256 ||
          (receipt.workosUserId?.length ?? 0) > 256
      )
    ) {
      throw new Error("Preflight receipt budget exceeded");
    }
    if (
      await ctx.db
        .query("migrationQuarantine")
        .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
        .first()
    ) {
      return 0;
    }
    for (const receipt of args.receipts) {
      await ctx.db.insert("migrationQuarantine", {
        ...receipt,
        source: "import_preflight",
        createdAt: Date.now(),
      });
    }
    return args.receipts.length;
  },
});

export const version = internalQuery({
  args: { ...pins, apiKeyFingerprint: v.string(), teakUserId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    assertPins(args);
    const key = process.env.WORKOS_API_KEY;
    if (!key || (await digest(key)) !== args.apiKeyFingerprint) {
      throw new Error("Importer credential changed");
    }
    const row = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", args.teakUserId))
      .unique();
    if (!row) {
      throw new Error("Importer owner missing");
    }
    return (await source(ctx, row)).sourceVersion;
  },
});
