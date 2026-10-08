import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { assertNamespace } from "./workosE2eState";

// Hosted signup cannot attach provider metadata, so the canary reserves a
// server-generated recipient first. Only the protected Management API adapter
// supplies provider evidence; every write re-runs admission in-transaction.
const lease = 30 * 60 * 1000;
const clockSkew = 5 * 60 * 1000;
const orphanMaximum = 90 * 24 * 60 * 60 * 1000;
const liveBudget = 3;

// Clients send crypto.randomUUID() once per reservation and reuse it on retry.
export const reservationRequestId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reservedLocalPart = /^e2e-signup-[0-9a-f]{32}@/;

const pins = {
  clientId: v.string(),
  environmentId: v.string(),
  credentialFingerprint: v.string(),
};
interface Pins {
  clientId: string;
  credentialFingerprint: string;
  environmentId: string;
}
const reservationId = v.id("e2eSignupReservations");

async function admitted(
  ctx: MutationCtx,
  id: Id<"e2eSignupReservations">,
  target: Pins
): Promise<Doc<"e2eSignupReservations">> {
  // Nested query shares this transaction: rotated credentials cannot write.
  await ctx.runQuery(internal.workosE2eState.admission, target);
  const row = await ctx.db.get("e2eSignupReservations", id);
  if (
    !row ||
    row.clientId !== target.clientId ||
    row.environmentId !== target.environmentId ||
    row.credentialFingerprint !== target.credentialFingerprint
  ) {
    throw new Error("E2E reservation target changed");
  }
  assertNamespace(row.email);
  return row;
}

async function ownerRows(ctx: QueryCtx, email: string, workosUserId?: string) {
  const byEmail = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .take(2);
  const byProvider = workosUserId
    ? await ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
        .take(2)
    : [];
  return [...byEmail, ...byProvider];
}

export const reserve = internalMutation({
  args: { ...pins, requestId: v.string(), email: v.string() },
  handler: async (ctx, { requestId, email, ...target }) => {
    await ctx.runQuery(internal.workosE2eState.admission, target);
    if (!reservationRequestId.test(requestId)) {
      throw new Error("Invalid E2E reservation request");
    }
    const prior = await ctx.db
      .query("e2eSignupReservations")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .take(2);
    if (prior.length > 1) {
      throw new Error("E2E reservation request conflict");
    }
    if (prior[0]) {
      // A retried request after a lost response never allocates a new recipient.
      return {
        kind: "reservation" as const,
        reservation: await admitted(ctx, prior[0]._id, target),
      };
    }
    assertNamespace(email);
    if (!reservedLocalPart.test(email)) {
      throw new Error("Invalid E2E reservation recipient");
    }
    const now = Date.now();
    const live = await ctx.db
      .query("e2eSignupReservations")
      .withIndex("by_closedAt_and_expiresAt", (q) =>
        q.eq("closedAt", undefined).gt("expiresAt", now)
      )
      .take(liveBudget);
    if (live.length >= liveBudget) {
      return { kind: "budget" as const };
    }
    const taken = await ctx.db
      .query("e2eSignupReservations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (taken || (await ownerRows(ctx, email)).length) {
      throw new Error("E2E reservation recipient conflict");
    }
    const id = await ctx.db.insert("e2eSignupReservations", {
      ...target,
      requestId,
      email,
      state: "pending",
      reservedAt: now,
      expiresAt: now + lease,
    });
    return {
      kind: "reservation" as const,
      reservation: await admitted(ctx, id, target),
    };
  },
});

// Called only after the adapter saw zero provider users for the recipient,
// which happens after the durable insert. Any later user is newer than this.
export const clear = internalMutation({
  args: { ...pins, id: reservationId },
  handler: async (ctx, { id, ...target }) => {
    const row = await admitted(ctx, id, target);
    if (row.state === "reserved") {
      return null;
    }
    if (
      row.state !== "pending" ||
      Date.now() >= row.expiresAt ||
      (await ownerRows(ctx, row.email)).length
    ) {
      throw new Error("E2E reservation cannot be cleared");
    }
    await ctx.db.patch("e2eSignupReservations", id, {
      state: "reserved",
      clearedAt: Date.now(),
    });
    return null;
  },
});

// Pins the provider user before any provider metadata write. The binding is
// immutable: a different user for the same reservation is a conflict.
export const bind = internalMutation({
  args: {
    ...pins,
    id: reservationId,
    workosUserId: v.string(),
    providerCreatedAt: v.number(),
  },
  handler: async (ctx, { id, workosUserId, providerCreatedAt, ...target }) => {
    const row = await admitted(ctx, id, target);
    if (row.state === "bound" && row.workosUserId === workosUserId) {
      return null;
    }
    if (
      row.state !== "reserved" ||
      row.clearedAt === undefined ||
      row.workosUserId !== undefined ||
      !/^user_[A-Za-z0-9]+$/.test(workosUserId) ||
      !Number.isFinite(providerCreatedAt) ||
      providerCreatedAt < row.clearedAt - clockSkew ||
      providerCreatedAt > row.expiresAt + clockSkew
    ) {
      throw new Error("E2E reservation binding refused");
    }
    for (const owner of await ownerRows(ctx, row.email, workosUserId)) {
      if (owner.email !== row.email || owner.workosUserId !== workosUserId) {
        throw new Error("E2E reservation owner conflict");
      }
    }
    await ctx.db.patch("e2eSignupReservations", id, {
      state: "bound",
      workosUserId,
      providerCreatedAt,
    });
    return null;
  },
});

// Canary success needs the real webhook-derived owner inside the lease.
export const qualify = internalMutation({
  args: { ...pins, id: reservationId, workosUserId: v.string() },
  handler: async (ctx, { id, workosUserId, ...target }) => {
    const row = await admitted(ctx, id, target);
    if (
      row.state !== "bound" ||
      row.workosUserId !== workosUserId ||
      Date.now() > row.expiresAt
    ) {
      throw new Error("E2E reservation cannot qualify");
    }
    const ready = await ctx.runQuery(internal.workosE2eState.readiness, {
      email: row.email,
      workosUserId,
    });
    if (!ready) {
      return false;
    }
    if (row.qualifiedAt === undefined) {
      await ctx.db.patch("e2eSignupReservations", id, {
        qualifiedAt: Date.now(),
      });
    }
    return true;
  },
});

// The only ownerless provider deletion: an exactly bound, flagged, unverified
// user with no Teak owner, no profile owner and no verified profile.
export const beginOwnerlessDeletion = internalMutation({
  args: { ...pins, id: reservationId, workosUserId: v.string() },
  handler: async (ctx, { id, workosUserId, ...target }) => {
    const row = await admitted(ctx, id, target);
    const profiles = await ctx.db
      .query("workosProfiles")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .take(2);
    if (
      row.state !== "bound" ||
      row.workosUserId !== workosUserId ||
      (await ownerRows(ctx, row.email, workosUserId)).length ||
      profiles.length > 1 ||
      profiles.some(
        (profile) =>
          profile.teakUserId !== undefined ||
          profile.profile?.emailVerified === true
      )
    ) {
      throw new Error("E2E ownerless deletion refused");
    }
    if (row.ownerlessDeletionAt === undefined) {
      await ctx.db.patch("e2eSignupReservations", id, {
        ownerlessDeletionAt: Date.now(),
      });
    }
    return null;
  },
});

export const close = internalMutation({
  args: {
    ...pins,
    id: reservationId,
    reason: v.union(
      v.literal("provider_deleted"),
      v.literal("absent_past_window")
    ),
  },
  handler: async (ctx, { id, reason, ...target }) => {
    const row = await admitted(ctx, id, target);
    if (row.state === "closed") {
      return null;
    }
    const owners = await ownerRows(ctx, row.email, row.workosUserId);
    let closable: boolean;
    if (reason === "provider_deleted") {
      // The bound identity is gone at the provider; any owner must be a
      // completed deletion of that same identity.
      closable = row.state === "bound";
      for (const owner of owners) {
        const deleting = await ctx.db
          .query("accountDeletionStates")
          .withIndex("by_userId", (q) => q.eq("userId", owner.teakUserId))
          .first();
        closable &&=
          owner.workosUserId === row.workosUserId &&
          owner.deletedAt !== undefined &&
          !deleting;
      }
    } else {
      // Absence is never proof a creation cannot still land, so an unbound
      // lease stays open until it is beyond the fixed orphan cleanup window.
      closable =
        row.workosUserId === undefined &&
        owners.length === 0 &&
        Date.now() > row.expiresAt + orphanMaximum + clockSkew;
    }
    if (!closable) {
      throw new Error("E2E reservation cannot close");
    }
    await ctx.db.patch("e2eSignupReservations", id, {
      state: "closed",
      closedAt: Date.now(),
      closedReason: reason,
    });
    return null;
  },
});

export const byEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    assertNamespace(email);
    const rows = await ctx.db
      .query("e2eSignupReservations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(2);
    if (rows.length > 1) {
      throw new Error("E2E reservation conflict");
    }
    return rows[0] ?? null;
  },
});

// Open leases that expired before the sweep's fixed start bound.
export const expired = internalQuery({
  args: { before: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { before, cursor }) => {
    const page = await ctx.db
      .query("e2eSignupReservations")
      .withIndex("by_closedAt_and_expiresAt", (q) =>
        q.eq("closedAt", undefined).lt("expiresAt", before)
      )
      .paginate({ cursor, numItems: 20 });
    for (const row of page.page) {
      assertNamespace(row.email);
    }
    return {
      emails: page.page.map((row) => row.email),
      cursor: page.continueCursor,
      done: page.isDone,
    };
  },
});
