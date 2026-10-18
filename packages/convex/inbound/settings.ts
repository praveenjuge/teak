import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import {
  env,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "../_generated/server";
import { getSessionUser } from "../securitySessions";
import { rateLimiter } from "../shared/rateLimits";

// Save by email: one shared address, save@<domain>. Mail sent to it from an
// account's sign-in email becomes cards once the account turns it on here.

const DEFAULT_INBOUND_EMAIL_DOMAIN = "in.teakvault.com";

export const inboundEmailDomain = (): string =>
  (env.INBOUND_EMAIL_DOMAIN ?? "").trim().toLowerCase() ||
  DEFAULT_INBOUND_EMAIL_DOMAIN;

export const inboundEmailAddress = (): string => `save@${inboundEmailDomain()}`;

export const readInboundSettings = (
  ctx: QueryCtx | MutationCtx,
  userId: string
) =>
  ctx.db
    .query("inboundEmailSettings")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

const signInEmail = async (ctx: QueryCtx | MutationCtx, userId: string) => {
  const user = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", userId))
    .unique();
  return user && user.deletedAt === undefined ? user.email : null;
};

export const getMine = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      address: v.string(),
      enabled: v.boolean(),
      lastReceivedAt: v.union(v.number(), v.null()),
      sender: v.string(),
    })
  ),
  handler: async (ctx) => {
    const session = await getSessionUser(ctx);
    const sender = session ? await signInEmail(ctx, session.teakUserId) : null;
    if (!(session && sender)) {
      return null;
    }
    const settings = await readInboundSettings(ctx, session.teakUserId);
    return {
      address: inboundEmailAddress(),
      enabled: settings?.enabled === true,
      lastReceivedAt: settings?.lastReceivedAt ?? null,
      sender,
    };
  },
});

const setEnabled = async (ctx: MutationCtx, enabled: boolean) => {
  const session = await getSessionUser(ctx);
  if (!session) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Sign in to change Save by email.",
    });
  }
  const userId = session.teakUserId;
  const limit = await rateLimiter.limit(ctx, "inboundEmailSettings", {
    key: userId,
    throws: false,
  });
  if (!limit.ok) {
    throw new ConvexError({
      code: "RATE_LIMITED",
      message: "Too many changes. Try again in a minute.",
    });
  }
  const now = Date.now();
  const existing = await readInboundSettings(ctx, userId);
  if (existing) {
    if (existing.enabled === enabled) {
      return null;
    }
    await ctx.db.patch("inboundEmailSettings", existing._id, {
      enabled,
      updatedAt: now,
    });
  } else if (enabled) {
    await ctx.db.insert("inboundEmailSettings", {
      createdAt: now,
      enabled,
      updatedAt: now,
      userId,
    });
  } else {
    return null;
  }
  await ctx.scheduler.runAfter(0, internal.telemetry.events.emitInboundEmail, {
    event: "email_save_toggled",
    enabled,
    userId,
  });
  return null;
};

export const enable = mutation({
  args: {},
  returns: v.null(),
  handler: (ctx) => setEnabled(ctx, true),
});

export const disable = mutation({
  args: {},
  returns: v.null(),
  handler: (ctx) => setEnabled(ctx, false),
});
