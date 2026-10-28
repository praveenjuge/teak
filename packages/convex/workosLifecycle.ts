import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { readComponentUser } from "./securitySessions";
import { isStorableEmail, normalizeIdentityEmail } from "./shared/workosIds";
import {
  currentWorkosDeletionTarget,
  expectedWorkosDeletionResolution,
} from "./workos/deletionCompletion";

export const INVALID_WORKOS_EVENT = "invalid_workos_event";
const permanentEventError = (message: string) =>
  new ConvexError({ code: INVALID_WORKOS_EVENT, message });
const retryableEventError = (message: string) => new Error(message);

const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);

const eventTime = (raw: string): number => {
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(
      raw
    );
  if (!parts || raw.length > 64) {
    throw permanentEventError("Invalid WorkOS event timestamp");
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
    throw permanentEventError("Invalid WorkOS event timestamp");
  }
  if (time > Date.now() + 300_000) {
    throw retryableEventError("WorkOS event timestamp is in the future");
  }
  return time;
};

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
    throw permanentEventError("Invalid WorkOS event input");
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
    throw permanentEventError("Invalid WorkOS event user");
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
      throw permanentEventError("Invalid WorkOS event profile");
    }
  }
  if (!deleting) {
    if (!isStorableEmail(email)) {
      throw permanentEventError("Invalid WorkOS event email");
    }
    for (const name of [profile.name, profile.firstName, profile.lastName]) {
      if (
        typeof name === "string" &&
        (name.length > 1024 || /\p{Cc}/u.test(name))
      ) {
        throw permanentEventError("Invalid WorkOS event name");
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
        url?.protocol !== "https:" ||
        url.username ||
        url.password ||
        profile.profilePictureUrl.length > 4096
      ) {
        throw permanentEventError("Invalid WorkOS event image");
      }
    }
  }
  return { time, workosUserId, deleting, email, externalId, profile };
};

const EMAIL_HOLDER_ROWS = 20;

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
    // A deleted account keeps its row and address; only a live owner holds
    // it, or an address someone used before deleting an account stays stuck.
    const holders = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(EMAIL_HOLDER_ROWS);
    if (
      holders.some(
        (holder) =>
          holder.deletedAt === undefined && holder.workosDeletedAt === undefined
      )
    ) {
      continue;
    }
    await ctx.db.patch("users", row._id, { email, emailVerified: true });
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
    const { time, workosUserId, deleting, email, profile } =
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
      // A redelivered deletion keeps its first receipt.
      const recorded = await ctx.db
        .query("migrationQuarantine")
        .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
          q.eq("workosUserId", workosUserId).eq("reason", "workos_user_deleted")
        )
        .first();
      if (!recorded) {
        const resolvedAt = await expectedWorkosDeletionResolution(ctx, receipt);
        await ctx.db.insert("migrationQuarantine", {
          ...receipt,
          ...(resolvedAt === undefined ? {} : { resolvedAt }),
        });
      }
    }
    return result;
  },
});
