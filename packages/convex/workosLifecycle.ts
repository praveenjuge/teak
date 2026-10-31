import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { readComponentUser } from "./securitySessions";
import {
  isStorableEmail,
  normalizeIdentityEmail,
  workosDisplayName,
} from "./shared/workosIds";
import { emailHeldByLiveOwner } from "./workosUsers";

export const INVALID_WORKOS_EVENT = "invalid_workos_event";
const permanentEventError = (message: string) =>
  new ConvexError({ code: INVALID_WORKOS_EVENT, message });

const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);

// The payload is signed by WorkOS (or read from its Events API), and the
// AuthKit component validates the profile it stores. Teak checks only what it
// uses: the IDs, the event time, and the address with its verification.
export const parseWorkosEvent = (event: {
  id: string;
  createdAt: string;
  event: "user.created" | "user.updated" | "user.deleted";
  data: Record<string, unknown>;
}) => {
  const time = Date.parse(event.createdAt);
  const workosUserId = event.data.id;
  if (!(Number.isFinite(time) && validId(event.id) && validId(workosUserId))) {
    throw permanentEventError("Invalid WorkOS event input");
  }
  const deleting = event.event === "user.deleted";
  const email =
    typeof event.data.email === "string"
      ? normalizeIdentityEmail(event.data.email)
      : "";
  const emailVerified = event.data.emailVerified;
  if (
    !(
      deleting ||
      (isStorableEmail(email) && typeof emailVerified === "boolean")
    )
  ) {
    throw permanentEventError("Invalid WorkOS event user");
  }
  return {
    time,
    workosUserId,
    deleting,
    email,
    emailVerified: emailVerified === true,
  };
};

const syncOwnerEmail = async (ctx: MutationCtx, workosUserId: string) => {
  const provider = await readComponentUser(ctx, workosUserId);
  if (!provider) {
    return;
  }
  const email = normalizeIdentityEmail(provider.email);
  if (!email) {
    return;
  }
  const rows = await ctx.db
    .query("users")
    .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
    .take(2);
  for (const row of rows) {
    if (row.deletedAt !== undefined || row.workosDeletedAt !== undefined) {
      continue;
    }
    const deleting = await ctx.db
      .query("accountDeletionStates")
      .withIndex("by_userId", (q) => q.eq("userId", row.teakUserId))
      .first();
    if (deleting) {
      continue;
    }
    const name = workosDisplayName(provider.firstName, provider.lastName);
    if (name && row.name !== name) {
      await ctx.db.patch("users", row._id, { name });
    }
    if (row.email === email || !provider.emailVerified) {
      // The row's verification tracks WorkOS's current address, which sign-in
      // reads; an unverified new address isn't adopted, but it stops sign-in.
      if (row.emailVerified !== provider.emailVerified) {
        await ctx.db.patch("users", row._id, {
          emailVerified: provider.emailVerified,
        });
      }
      continue;
    }
    const taken = await emailHeldByLiveOwner(ctx, email);
    // WorkOS verified its current address, so sign-in may go on even when
    // another account holds it and the row keeps its old one.
    await ctx.db.patch(
      "users",
      row._id,
      taken ? { emailVerified: true } : { email, emailVerified: true }
    );
  }
};

export const applyWorkosEvent = internalMutation({
  args: {
    id: v.string(),
    createdAt: v.string(),
    event: v.union(
      v.literal("user.created"),
      v.literal("user.updated"),
      v.literal("user.deleted")
    ),
    data: v.record(v.string(), v.any()),
  },
  returns: v.object({
    status: v.union(
      v.literal("applied"),
      v.literal("deleted"),
      v.literal("quarantined")
    ),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, event) => {
    const { time, workosUserId, deleting, email, emailVerified } =
      parseWorkosEvent(event);
    let result:
      | { status: "applied" | "deleted" }
      | { status: "quarantined"; reason: string } = {
      status: deleting ? "deleted" : "applied",
    };
    if (event.event === "user.created") {
      const linked = await ctx.runMutation(
        internal.workosUsers.linkWorkosUser,
        {
          workosUserId,
          email,
          emailVerified,
          source: "webhook",
        }
      );
      if (linked.status === "quarantined") {
        result = { status: "quarantined", reason: linked.reason };
      }
    }
    if (!deleting) {
      await syncOwnerEmail(ctx, workosUserId);
    }
    if (deleting) {
      const rows = await ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
        .take(2);
      for (const row of rows) {
        if (row.workosDeletedAt === undefined) {
          await ctx.db.patch("users", row._id, { workosDeletedAt: time });
        }
      }
      // A redelivered deletion keeps its first tombstone. It is final, so it
      // is written resolved and stays out of the operators' queue.
      const recorded = await ctx.db
        .query("migrationQuarantine")
        .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
          q.eq("workosUserId", workosUserId).eq("reason", "workos_user_deleted")
        )
        .first();
      if (!recorded) {
        const now = Date.now();
        await ctx.db.insert("migrationQuarantine", {
          workosUserId,
          ...(rows.length === 1 ? { teakUserId: rows[0].teakUserId } : {}),
          email: isStorableEmail(email) ? email : "",
          reason: "workos_user_deleted",
          source: "webhook",
          createdAt: now,
          resolvedAt: now,
          workosDeletionEventAt: time,
        });
      }
    }
    return result;
  },
});
