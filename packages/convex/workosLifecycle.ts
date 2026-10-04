import type { FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { normalizeIdentityEmail } from "./userIdentityTable";

const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);

const eventTime = (raw: string): number => {
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(
      raw
    );
  if (!parts || raw.length > 64) {
    throw new Error("Invalid WorkOS event timestamp");
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
    time < 0 ||
    time > Date.now() + 300_000
  ) {
    throw new Error("Invalid WorkOS event timestamp");
  }
  // The approved ledger uses milliseconds. Finer timestamps that collide are
  // treated by the equal-time conflict guard, never as verification promotion.
  return time;
};

// Not an HTTP/signature boundary. Only a future verified webhook adapter or
// trusted reconciliation path may supply this original event envelope.
// Unlike AuthKit.events(), retain the original event ID, type and timestamp.
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
      v.literal("stale"),
      v.literal("deleted"),
      v.literal("ignored_deleted"),
      v.literal("quarantined")
    ),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, event) => {
    const time = eventTime(event.createdAt);
    const userId = event.data.id;
    if (
      !(validId(event.id) && validId(userId)) ||
      Object.keys(event.data).length > 64 ||
      JSON.stringify(event.data).length > 64 * 1024
    ) {
      throw new Error("Invalid WorkOS event input");
    }
    const deleting = event.event === "user.deleted";
    const rawEmail = event.data.email;
    const normalizedEmail =
      typeof rawEmail === "string" ? normalizeIdentityEmail(rawEmail) : "";
    const email =
      normalizedEmail.length <= 320 &&
      /^[^\s@]+@[^\s@]+$/.test(normalizedEmail) &&
      !/\p{Cc}/u.test(normalizedEmail)
        ? normalizedEmail
        : "";
    const externalId = event.data.externalId;
    if (
      !deleting &&
      (!email ||
        typeof event.data.emailVerified !== "boolean" ||
        (externalId !== undefined &&
          externalId !== null &&
          !validId(externalId)))
    ) {
      throw new Error("Invalid WorkOS event user");
    }
    const duplicate = await ctx.db
      .query("workosEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", event.id))
      .unique();
    if (duplicate) {
      return { status: "duplicate" as const };
    }
    const rows = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", userId))
      .take(2);
    const row = rows.length === 1 ? rows[0] : undefined;
    const receipt = () =>
      ctx.db.insert("workosEvents", {
        eventId: event.id,
        workosUserId: userId,
        type: event.event,
        createdAt: time,
        ...(deleting
          ? {}
          : {
              email,
              emailVerified: event.data.emailVerified as boolean,
              externalId: (externalId as string | null | undefined) ?? null,
            }),
      });
    const quarantine = async (reason: string) => {
      await ctx.db.insert("migrationQuarantine", {
        workosUserId: userId,
        ...(row ? { teakUserId: row.teakUserId } : {}),
        email,
        reason,
        source: "webhook",
        createdAt: Date.now(),
      });
      await receipt();
      return { status: "quarantined" as const, reason };
    };
    const tombstone = await ctx.db
      .query("workosEvents")
      .withIndex("by_workosUserId_and_type", (q) =>
        q.eq("workosUserId", userId).eq("type", "user.deleted")
      )
      .first();
    if (
      tombstone ||
      rows.some((mapped) => mapped.workosDeletedAt !== undefined)
    ) {
      await receipt();
      return { status: "ignored_deleted" as const };
    }
    const previous = await ctx.db
      .query("workosEvents")
      .withIndex("by_workosUserId_and_createdAt", (q) =>
        q.eq("workosUserId", userId)
      )
      .order("desc")
      .first();
    const lastTime = Math.max(
      previous?.createdAt ?? -1,
      row?.lastWorkosEventAt ?? -1
    );
    if (deleting) {
      // Provider deletion is terminal, even if its delivery arrives late. Never
      // clear the provider ID, global tombstone, Better Auth profile or vault.
      for (const mapped of rows) {
        await ctx.db.patch("users", mapped._id, {
          workosDeletedAt: time,
          workosEmailVerified: false,
          lastWorkosEventAt: Math.max(
            time,
            lastTime,
            mapped.lastWorkosEventAt ?? -1
          ),
        });
      }
      await ctx.db.insert("migrationQuarantine", {
        workosUserId: userId,
        ...(row ? { teakUserId: row.teakUserId } : {}),
        email,
        reason: "workos_user_deleted",
        source: "webhook",
        createdAt: Date.now(),
      });
      await receipt();
      return { status: "deleted" as const };
    }
    if (rows.length > 1) {
      return quarantine("duplicate_mapping");
    }
    if (time < lastTime) {
      await receipt();
      return { status: "stale" as const };
    }
    if (time === lastTime) {
      const sameProfile =
        row &&
        row.workosEmail === email &&
        row.workosEmailVerified === event.data.emailVerified &&
        (externalId === undefined ||
          externalId === null ||
          externalId === row.teakUserId);
      if (sameProfile) {
        await receipt();
        return { status: "stale" as const };
      }
      if (row) {
        await ctx.db.patch("users", row._id, { workosEmailVerified: false });
      }
      return quarantine("equal_timestamp_conflict");
    }
    const linked: FunctionReturnType<
      typeof internal.workosUsers.linkWorkosUser
    > = await ctx.runMutation(internal.workosUsers.linkWorkosUser, {
      workosUserId: userId,
      email,
      emailVerified: event.data.emailVerified as boolean,
      ...(externalId === undefined || externalId === null
        ? {}
        : { externalId: externalId as string }),
      source: "webhook",
      allowCreate: event.event === "user.created",
    });
    if (linked.status === "quarantined") {
      if (row) {
        await ctx.db.patch("users", row._id, {
          workosEmailVerified: false,
          lastWorkosEventAt: time,
        });
      }
      await receipt();
      return { status: "quarantined" as const, reason: linked.reason };
    }
    const owner = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", linked.teakUserId))
      .unique();
    if (!owner) {
      throw new Error("Linked WorkOS owner unavailable");
    }
    await ctx.db.patch("users", owner._id, {
      workosEmail: email,
      workosEmailVerified: event.data.emailVerified as boolean,
      lastWorkosEventAt: time,
    });
    await receipt();
    return { status: "applied" as const };
  },
});
