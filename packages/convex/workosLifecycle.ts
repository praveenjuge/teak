import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { normalizeIdentityEmail } from "./userIdentityTable";
import {
  currentWorkosDeletionTarget,
  expectedWorkosDeletionResolution,
} from "./workosDeletionCompletion";
import { applyWorkosProfileInTransaction } from "./workosProfileApply";

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

// Only verified webhook and admitted reconciliation adapters supply original
// provider envelopes. Replay records real receipts without new-user side effects.
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
    replay: v.optional(v.boolean()),
  },
  returns: v.object({
    status: v.union(
      v.literal("applied"),
      v.literal("duplicate"),
      v.literal("stale"),
      v.literal("deleted"),
      v.literal("ignored_deleted"),
      v.literal("quarantined")
    ),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, event) => {
    const time = eventTime(event.createdAt);
    const workosUserId = event.data.id;
    if (
      !(validId(event.id) && validId(workosUserId)) ||
      Object.keys(event.data).length > 64 ||
      JSON.stringify(event.data).length > 64 * 1024
    ) {
      throw invalid("Invalid WorkOS event input");
    }
    const duplicate = await ctx.db
      .query("workosEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", event.id))
      .unique();
    if (duplicate) {
      return { status: "duplicate" as const };
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
    const args = {
      workosUserId,
      source: { kind: "event" as const, createdAt: event.createdAt },
      state: deleting
        ? { kind: "deleted" as const }
        : {
            kind: "active" as const,
            profile,
            ...(event.data.updatedAt === undefined
              ? {}
              : { providerUpdatedAt: event.data.updatedAt as string }),
          },
    };
    let result = await applyWorkosProfileInTransaction(ctx, args);
    if (
      !deleting &&
      event.event === "user.created" &&
      event.replay !== true &&
      result.status === "quarantined" &&
      result.reason === "missing_mapping"
    ) {
      const linked = await ctx.runMutation(
        internal.workosUsers.linkWorkosUser,
        {
          workosUserId,
          email,
          emailVerified: profile.emailVerified,
          externalId: profile.externalId,
          source: "webhook",
          allowCreate: true,
        }
      );
      result =
        linked.status === "linked"
          ? await applyWorkosProfileInTransaction(ctx, args)
          : linked;
    }
    if (deleting) {
      const rows = await ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
        .take(2);
      const target = await currentWorkosDeletionTarget();
      const receipt = {
        workosUserId,
        ...(rows.length === 1 ? { teakUserId: rows[0].teakUserId } : {}),
        email:
          email.length <= 320 &&
          /^[^\s@]+@[^\s@]+$/.test(email) &&
          !/\p{Cc}/u.test(email)
            ? email
            : "",
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
            ...(email &&
            email.length <= 320 &&
            /^[^\s@]+@[^\s@]+$/.test(email) &&
            !/\p{Cc}/u.test(email)
              ? { email }
              : {}),
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
    if (result.status === "rejected") {
      throw new Error("Invalid event reconciliation state");
    }
    if (result.status === "unchanged") {
      return { status: "stale" as const };
    }
    return result.status === "quarantined"
      ? { status: result.status, reason: result.reason }
      : { status: result.status };
  },
});
