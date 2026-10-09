import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { readComponentUser } from "./securitySessions";
import { isStorableEmail, normalizeIdentityEmail } from "./shared/workosIds";
import {
  currentWorkosDeletionTarget,
  expectedWorkosDeletionResolution,
} from "./workosDeletionCompletion";

// A payload Teak can never apply, however often WorkOS retries it. The webhook
// records it as a dead letter and acknowledges it instead of failing forever.
export const INVALID_WORKOS_EVENT = "invalid_workos_event";
const invalid = (message: string) =>
  new ConvexError({ code: INVALID_WORKOS_EVENT, message });

const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);

const eventTime = (raw: string): number => {
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(
      raw
    );
  if (!parts || raw.length > 64) {
    throw invalid("Invalid WorkOS event timestamp");
  }
  const [, year, month, day, hour, minute, second, offset] = parts;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
  const validCalendar =
    calendar.getUTCFullYear() === Number(year) &&
    calendar.getUTCMonth() + 1 === Number(month) &&
    calendar.getUTCDate() === Number(day);
  const validClock =
    Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
  const validOffset =
    offset.toUpperCase() === "Z" ||
    (Number(offset.slice(1, 3)) <= 23 && Number(offset.slice(4)) <= 59);
  const time = Date.parse(raw);
  if (
    !(validCalendar && validClock && validOffset && Number.isFinite(time)) ||
    time < 0
  ) {
    throw invalid("Invalid WorkOS event timestamp");
  }
  // Clock skew passes with time, so WorkOS keeps retrying this one.
  if (time > Date.now() + 300_000) {
    throw new Error("WorkOS event timestamp is in the future");
  }
  // The approved ledger uses milliseconds. Finer timestamps that collide are
  // treated by the equal-time conflict guard, never as verification promotion.
  return time;
};

// Every check Teak needs before any store sees the event. It throws the
// INVALID_WORKOS_EVENT ConvexError for payloads Teak can never apply, so the
// webhook dead-letters them before the component's own validators run.
export const parseWorkosEvent = (event: {
  id: string;
  createdAt: string;
  event: "user.created" | "user.updated" | "user.deleted";
  data: Record<string, unknown>;
}) => {
  const time = eventTime(event.createdAt);
  const workosUserId = event.data.id;
  if (
    !(validId(event.id) && validId(workosUserId)) ||
    Object.keys(event.data).length > 64 ||
    JSON.stringify(event.data).length > 64 * 1024
  ) {
    throw invalid("Invalid WorkOS event input");
  }
  const deleting = event.event === "user.deleted";
  const email =
    typeof event.data.email === "string"
      ? normalizeIdentityEmail(event.data.email)
      : "";
  const externalId = event.data.externalId ?? null;
  if (
    !deleting &&
    (!email ||
      typeof event.data.emailVerified !== "boolean" ||
      (externalId !== null && !validId(externalId)) ||
      (event.data.updatedAt !== undefined &&
        typeof event.data.updatedAt !== "string"))
  ) {
    throw invalid("Invalid WorkOS event user");
  }
  const profile = {
    email,
    emailVerified: event.data.emailVerified as boolean,
    externalId: externalId as string | null,
    name: event.data.name ?? null,
    firstName: event.data.firstName ?? null,
    lastName: event.data.lastName ?? null,
    profilePictureUrl: event.data.profilePictureUrl ?? null,
  };
  for (const value of [
    profile.name,
    profile.firstName,
    profile.lastName,
    profile.profilePictureUrl,
  ]) {
    if (!deleting && value !== null && typeof value !== "string") {
      throw invalid("Invalid WorkOS event profile");
    }
  }
  if (!deleting) {
    // Shapes the component would store as is: reject them before either store.
    if (!isStorableEmail(email)) {
      throw invalid("Invalid WorkOS event email");
    }
    for (const name of [profile.name, profile.firstName, profile.lastName]) {
      if (
        typeof name === "string" &&
        (name.length > 1024 || /\p{Cc}/u.test(name))
      ) {
        throw invalid("Invalid WorkOS event name");
      }
    }
    if (typeof profile.profilePictureUrl === "string") {
      let url: URL | undefined;
      try {
        url = new URL(profile.profilePictureUrl);
      } catch {
        url = undefined;
      }
      if (
        !url ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        profile.profilePictureUrl.length > 4096
      ) {
        throw invalid("Invalid WorkOS event image");
      }
    }
  }
  return { time, workosUserId, deleting, email, externalId, profile };
};

// Keeps the owner's stored address in step with the provider, for the lookups
// that still read it (admin seeding, the admin user list and email linking).
// The values come from the component's stored profile rather than the event,
// so an out-of-order delivery the component ignored can't roll them back.
// A new address is copied only once WorkOS has verified it and no other owner
// holds it, so an unverified change can't claim someone else's address.
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
    if (row.email === email) {
      if (row.emailVerified !== provider.emailVerified) {
        await ctx.db.patch("users", row._id, {
          emailVerified: provider.emailVerified,
        });
      }
      continue;
    }
    if (!provider.emailVerified) {
      continue;
    }
    const holders = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(1);
    if (holders.length > 0) {
      continue;
    }
    await ctx.db.patch("users", row._id, { email, emailVerified: true });
  }
};

// Only the verified webhook and the Events API catch-up supply provider events.
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
      v.literal("duplicate"),
      v.literal("deleted"),
      v.literal("quarantined")
    ),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, event) => {
    const { time, workosUserId, deleting, email, externalId, profile } =
      parseWorkosEvent(event);
    const duplicate = await ctx.db
      .query("workosEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", event.id))
      .unique();
    if (duplicate) {
      return { status: "duplicate" as const };
    }
    // The WorkOS component stores the profile in the same transaction. Teak
    // keeps only what the component can't: owner linking and deletion proof.
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
          emailVerified: profile.emailVerified,
          externalId: profile.externalId,
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
      // A permanent tombstone: these owners never sign in through WorkOS again.
      for (const row of rows) {
        if (row.workosDeletedAt === undefined) {
          await ctx.db.patch("users", row._id, { workosDeletedAt: time });
        }
      }
      const target = await currentWorkosDeletionTarget();
      const receipt = {
        workosUserId,
        ...(rows.length === 1 ? { teakUserId: rows[0].teakUserId } : {}),
        email: isStorableEmail(email) ? email : "",
        reason: "workos_user_deleted",
        source: "webhook",
        createdAt: Date.now(),
        workosDeletionEventAt: time,
        ...(target ? { workosDeletionTarget: target } : {}),
      };
      const resolvedAt = await expectedWorkosDeletionResolution(ctx, receipt);
      await ctx.db.insert("migrationQuarantine", {
        ...receipt,
        ...(resolvedAt === undefined ? {} : { resolvedAt }),
      });
    }
    await ctx.db.insert("workosEvents", {
      eventId: event.id,
      workosUserId,
      type: event.event,
      createdAt: time,
      ...(deleting
        ? {
            ...(email && isStorableEmail(email) ? { email } : {}),
            ...(typeof event.data.emailVerified === "boolean"
              ? { emailVerified: event.data.emailVerified }
              : {}),
            ...(externalId === null || validId(externalId)
              ? { externalId }
              : {}),
          }
        : {
            email,
            emailVerified: profile.emailVerified,
            externalId: profile.externalId,
          }),
    });
    return result;
  },
});
