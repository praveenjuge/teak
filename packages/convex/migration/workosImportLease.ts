import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import {
  readAccountChangesPaused,
  readAuthPrimary,
  readSignupsDisabled,
} from "../env";

export const importLeasePins = {
  environmentId: v.string(),
  clientId: v.string(),
  apiKeyFingerprint: v.string(),
};
export const importLeaseOwner = { holder: v.string(), generation: v.number() };
export async function assertImportBinding(
  args: {
    environmentId: string;
    clientId: string;
    apiKeyFingerprint: string;
  },
  writer = true
) {
  const key = process.env.WORKOS_API_KEY;
  const fingerprint = key
    ? [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
    : null;
  if (
    !key ||
    fingerprint !== args.apiKeyFingerprint ||
    args.environmentId !== process.env.WORKOS_ENVIRONMENT_ID ||
    args.clientId !== process.env.WORKOS_CLIENT_ID ||
    (writer && (readAuthPrimary() !== "betterauth" || !readSignupsDisabled()))
  ) {
    throw new Error(
      "Importer lease credential binding or frozen Better Auth deployment changed"
    );
  }
}
async function lease(ctx: QueryCtx | MutationCtx) {
  const rows = await ctx.db
    .query("workosImportLeases")
    .withIndex("by_scope", (q) => q.eq("scope", "management_import"))
    .take(2);
  if (rows.length > 1) {
    throw new Error("Ambiguous importer lease");
  }
  return rows[0] ?? null;
}
export async function assertImportLease(
  ctx: QueryCtx | MutationCtx,
  args: {
    environmentId: string;
    clientId: string;
    apiKeyFingerprint: string;
    holder: string;
    generation: number;
  },
  allowIntent = false
) {
  await assertImportBinding(args);
  const row = await lease(ctx);
  if (
    row?.status !== "active" ||
    row.holder !== args.holder ||
    row.generation !== args.generation ||
    row.environmentId !== args.environmentId ||
    row.clientId !== args.clientId ||
    row.apiKeyFingerprint !== args.apiKeyFingerprint ||
    (!allowIntent && row.remoteIntent)
  ) {
    throw new Error("Inactive or uncertain importer lease");
  }
  return row;
}
export const acquire = internalMutation({
  args: { ...importLeasePins, holder: v.string(), runId: v.string() },
  returns: v.object(importLeaseOwner),
  handler: async (ctx, args) => {
    await assertImportBinding(args);
    if (
      !(
        /^[0-9a-f-]{36}$/.test(args.holder) && /^[0-9a-f]{64}$/.test(args.runId)
      )
    ) {
      throw new Error("Invalid importer invocation");
    }
    const row = await lease(ctx);
    if (row && (row.status !== "released" || row.remoteIntent)) {
      throw new Error(
        "Importer already active or uncertain; operator quiescence required"
      );
    }
    const now = Date.now(),
      generation = (row?.generation ?? 0) + 1;
    const next = {
      ...args,
      scope: "management_import" as const,
      generation,
      admittedAt: now,
      heartbeatAt: now,
      status: "active" as const,
    };
    if (row) {
      await ctx.db.replace("workosImportLeases", row._id, next);
    } else {
      await ctx.db.insert("workosImportLeases", next);
    }
    return { holder: args.holder, generation };
  },
});
export const beginRemote = internalMutation({
  args: {
    ...importLeasePins,
    ...importLeaseOwner,
    kind: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("delete")
    ),
    teakUserId: v.string(),
    sourceVersion: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await assertImportLease(ctx, args);
    const current: string = await ctx.runQuery(
      internal.migration.workosImportSource.version,
      {
        environmentId: args.environmentId,
        clientId: args.clientId,
        apiKeyFingerprint: args.apiKeyFingerprint,
        teakUserId: args.teakUserId,
      }
    );
    if (current !== args.sourceVersion) {
      throw new Error("Importer source changed before provider dispatch");
    }
    const now = Date.now();
    await ctx.db.patch("workosImportLeases", row._id, {
      heartbeatAt: now,
      remoteIntent: {
        kind: args.kind,
        teakUserId: args.teakUserId,
        sourceVersion: args.sourceVersion,
        startedAt: now,
      },
    });
    return null;
  },
});
export const acknowledgeRemote = internalMutation({
  args: {
    ...importLeasePins,
    ...importLeaseOwner,
    teakUserId: v.string(),
    sourceVersion: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await assertImportLease(ctx, args, true);
    if (
      row.remoteIntent?.teakUserId !== args.teakUserId ||
      row.remoteIntent.sourceVersion !== args.sourceVersion
    ) {
      throw new Error("Importer remote intent changed");
    }
    const now = Date.now();
    await ctx.db.patch("workosImportLeases", row._id, {
      remoteIntent: undefined,
      heartbeatAt: now,
      lastAcknowledgedAt: now,
    });
    return null;
  },
});
export const markUncertain = internalMutation({
  args: { ...importLeasePins, ...importLeaseOwner },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await assertImportLease(ctx, args, true);
    if (!row.remoteIntent) {
      throw new Error("No pending importer remote intent");
    }
    await ctx.db.patch("workosImportLeases", row._id, {
      status: "uncertain",
      heartbeatAt: Date.now(),
    });
    return null;
  },
});
export const release = internalMutation({
  args: { ...importLeasePins, ...importLeaseOwner },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await assertImportLease(ctx, args);
    await ctx.db.patch("workosImportLeases", row._id, {
      status: "released",
      heartbeatAt: Date.now(),
    });
    return null;
  },
});
export const quiescence = internalQuery({
  args: importLeasePins,
  returns: v.object({
    ready: v.boolean(),
    generation: v.union(v.number(), v.null()),
    holder: v.union(v.string(), v.null()),
    pendingRemote: v.boolean(),
    barrierHeld: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await assertImportBinding(args, false);
    const row = await lease(ctx);
    return {
      ready:
        !row ||
        ((row.status === "released" || row.status === "quiesced") &&
          !row.remoteIntent),
      generation: row?.generation ?? null,
      holder: row?.holder ?? null,
      pendingRemote: Boolean(row?.remoteIntent),
      barrierHeld: row?.status === "quiesced" && !row.remoteIntent,
    };
  },
});

export const verify = internalQuery({
  args: { ...importLeasePins, ...importLeaseOwner },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertImportLease(ctx, args);
    return null;
  },
});

function assertPausedBarrier() {
  if (!(readSignupsDisabled() && readAccountChangesPaused())) {
    throw new Error(
      "Importer barrier requires paused account changes and frozen signups"
    );
  }
}
export const establishQuiescence = internalMutation({
  args: { ...importLeasePins, holder: v.string(), runId: v.string() },
  returns: v.object(importLeaseOwner),
  handler: async (ctx, args) => {
    await assertImportBinding(args, false);
    assertPausedBarrier();
    if (
      !(
        /^[0-9a-f-]{36}$/.test(args.holder) && /^[0-9a-f]{64}$/.test(args.runId)
      )
    ) {
      throw new Error("Invalid importer barrier invocation");
    }
    const row = await lease(ctx);
    if (
      row?.status === "quiesced" &&
      row.holder === args.holder &&
      row.runId === args.runId &&
      row.environmentId === args.environmentId &&
      row.clientId === args.clientId &&
      row.apiKeyFingerprint === args.apiKeyFingerprint &&
      !row.remoteIntent
    ) {
      return { holder: row.holder, generation: row.generation };
    }
    if (row && (row.status !== "released" || row.remoteIntent)) {
      throw new Error(
        "Importer barrier cannot drain an active or uncertain holder"
      );
    }
    const now = Date.now(),
      generation = (row?.generation ?? 0) + 1;
    const next = {
      ...args,
      scope: "management_import" as const,
      generation,
      admittedAt: now,
      heartbeatAt: now,
      status: "quiesced" as const,
    };
    if (row) {
      await ctx.db.replace("workosImportLeases", row._id, next);
    } else {
      await ctx.db.insert("workosImportLeases", next);
    }
    return { holder: args.holder, generation };
  },
});
export async function assertHeldBarrier(
  ctx: QueryCtx | MutationCtx,
  args: {
    environmentId: string;
    clientId: string;
    apiKeyFingerprint: string;
    holder: string;
    generation: number;
  }
) {
  await assertImportBinding(args, false);
  assertPausedBarrier();
  const row = await lease(ctx);
  if (
    row?.status !== "quiesced" ||
    row.remoteIntent ||
    row.holder !== args.holder ||
    row.generation !== args.generation ||
    row.environmentId !== args.environmentId ||
    row.clientId !== args.clientId ||
    row.apiKeyFingerprint !== args.apiKeyFingerprint
  ) {
    throw new Error("Importer quiescence barrier not held by this operator");
  }
  return row;
}
export const verifyQuiescence = internalQuery({
  args: { ...importLeasePins, ...importLeaseOwner },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertHeldBarrier(ctx, args);
    return null;
  },
});
export const releaseQuiescence = internalMutation({
  args: { ...importLeasePins, ...importLeaseOwner },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await assertHeldBarrier(ctx, args);
    await ctx.db.patch("workosImportLeases", row._id, {
      status: "released",
      heartbeatAt: Date.now(),
    });
    return null;
  },
});
