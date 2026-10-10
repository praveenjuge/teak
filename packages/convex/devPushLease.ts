import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { readIsDevDeployment } from "./env";

// Every checkout and cloud session pushes to the one shared dev deployment, so
// only one of them may run `convex dev` at a time. `bun run dev` holds this
// lease while it pushes (scripts/convex-push-lease.ts) and renews it with a
// heartbeat; a holder that stops renewing loses it after LEASE_TTL_MS.

export const LEASE_TTL_MS = 2 * 60 * 1000;
const LEASE_NAME = "push";

const holder = v.object({ id: v.string(), label: v.string() });
const lastPush = v.object({
  label: v.string(),
  commit: v.string(),
  at: v.number(),
});
const leaseState = v.object({
  holder: v.union(
    v.object({ id: v.string(), label: v.string(), expiresAt: v.number() }),
    v.null()
  ),
  lastPush: v.union(lastPush, v.null()),
});

const assertDevDeployment = () => {
  if (!readIsDevDeployment()) {
    throw new Error(
      "The push lease runs only on the shared dev deployment (TEAK_DEV_DEPLOYMENT=true)."
    );
  }
};

const readLease = (ctx: QueryCtx) =>
  ctx.db
    .query("devPushLeases")
    .withIndex("by_name", (q) => q.eq("name", LEASE_NAME))
    .unique();

const describe = (lease: Doc<"devPushLeases"> | null, now: number) => ({
  holder:
    lease?.holderId && lease.holderLabel && lease.expiresAt > now
      ? {
          id: lease.holderId,
          label: lease.holderLabel,
          expiresAt: lease.expiresAt,
        }
      : null,
  lastPush: lease?.lastPush ?? null,
});

const holds = (lease: Doc<"devPushLeases"> | null, id: string, now: number) =>
  lease?.holderId === id && lease.expiresAt > now;

const writeLease = async (
  ctx: MutationCtx,
  lease: Doc<"devPushLeases"> | null,
  fields: Partial<Omit<Doc<"devPushLeases">, "_id" | "_creationTime" | "name">>
) => {
  if (lease) {
    await ctx.db.patch("devPushLeases", lease._id, fields);
  } else {
    await ctx.db.insert("devPushLeases", {
      name: LEASE_NAME,
      expiresAt: 0,
      ...fields,
    });
  }
};

/** Take the lease when it is free, expired or already ours; `force` takes it over. */
export const acquire = internalMutation({
  args: { holder, force: v.boolean() },
  returns: v.object({ granted: v.boolean(), state: leaseState }),
  handler: async (ctx, args) => {
    assertDevDeployment();
    const now = Date.now();
    const lease = await readLease(ctx);
    const current = describe(lease, now).holder;
    if (current && current.id !== args.holder.id && !args.force) {
      return { granted: false, state: describe(lease, now) };
    }
    await writeLease(ctx, lease, {
      holderId: args.holder.id,
      holderLabel: args.holder.label,
      expiresAt: now + LEASE_TTL_MS,
    });
    return { granted: true, state: describe(await readLease(ctx), now) };
  },
});

/** Renew the lease. Not granted once another checkout took it or it expired. */
export const heartbeat = internalMutation({
  args: { holderId: v.string() },
  returns: v.object({ granted: v.boolean(), state: leaseState }),
  handler: async (ctx, args) => {
    assertDevDeployment();
    const now = Date.now();
    const lease = await readLease(ctx);
    if (!(lease && holds(lease, args.holderId, now))) {
      return { granted: false, state: describe(lease, now) };
    }
    await ctx.db.patch("devPushLeases", lease._id, {
      expiresAt: now + LEASE_TTL_MS,
    });
    return { granted: true, state: describe(await readLease(ctx), now) };
  },
});

export const release = internalMutation({
  args: { holderId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertDevDeployment();
    const lease = await readLease(ctx);
    if (lease && holds(lease, args.holderId, Date.now())) {
      await ctx.db.patch("devPushLeases", lease._id, {
        holderId: undefined,
        holderLabel: undefined,
        expiresAt: 0,
      });
    }
    return null;
  },
});

/** Record what the holder last pushed, so others can see which code is live. */
export const recordPush = internalMutation({
  args: { holderId: v.string(), label: v.string(), commit: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    assertDevDeployment();
    const now = Date.now();
    const lease = await readLease(ctx);
    if (!(lease && holds(lease, args.holderId, now))) {
      return false;
    }
    await ctx.db.patch("devPushLeases", lease._id, {
      lastPush: { label: args.label, commit: args.commit, at: now },
    });
    return true;
  },
});

export const status = internalQuery({
  args: {},
  returns: leaseState,
  handler: async (ctx) => {
    assertDevDeployment();
    return describe(await readLease(ctx), Date.now());
  },
});
