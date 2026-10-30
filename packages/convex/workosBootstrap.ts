import type { FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { type ActionCtx, action, mutation } from "./_generated/server";
import {
  getWorkosBootstrapIdentity,
  readWorkosProfile,
} from "./securitySessions";
import { rateLimiter } from "./shared/rateLimits";
import { createWorkosClient } from "./shared/workosClient";
import { isStorableEmail, normalizeIdentityEmail } from "./shared/workosIds";
import { authKit } from "./workosAuthKit";
import { ingestWorkosEvent } from "./workosWebhook";

const bootstrapResult = v.union(
  v.object({ status: v.literal("ok"), teakUserId: v.string() }),
  v.object({ status: v.literal("verify_email") }),
  v.object({ status: v.literal("frozen") }),
  v.object({ status: v.literal("quarantined"), reason: v.string() })
);
type BootstrapResult = typeof bootstrapResult.type;

export const ensureUser = mutation({
  args: {},
  returns: bootstrapResult,
  handler: async (ctx) => {
    const identity = await getWorkosBootstrapIdentity(ctx);
    if (!identity) {
      return { status: "quarantined" as const, reason: "invalid_session" };
    }
    if (!identity.emailVerified) {
      return { status: "verify_email" as const };
    }
    const profile = await readWorkosProfile(ctx, identity.workosUserId);
    if (!profile) {
      return { status: "quarantined" as const, reason: "profile_pending" };
    }
    if (profile.emailVerified !== true) {
      return { status: "verify_email" as const };
    }
    const email = normalizeIdentityEmail(profile.email);
    if (profile.id !== identity.workosUserId || !isStorableEmail(email)) {
      return { status: "quarantined" as const, reason: "invalid_profile" };
    }
    const linked: FunctionReturnType<
      typeof internal.workosUsers.linkWorkosUser
    > = await ctx.runMutation(internal.workosUsers.linkWorkosUser, {
      workosUserId: identity.workosUserId,
      email,
      emailVerified: true,
      source: "ensureUser",
    });
    if (linked.status === "quarantined") {
      return linked.reason === "signups_frozen"
        ? { status: "frozen" as const }
        : linked;
    }
    const resolved: FunctionReturnType<
      typeof internal.workosIdentity.resolveWorkosOwner
    > = await ctx.runQuery(internal.workosIdentity.resolveWorkosOwner, {
      workosUserId: identity.workosUserId,
      verification: { kind: "session", emailVerified: identity.emailVerified },
    });
    return resolved.status === "ok"
      ? resolved
      : { status: "quarantined" as const, reason: resolved.reason };
  },
});

// A new account's profile reaches Convex by webhook, which can land after the
// browser is back from sign-up. Window and pages bound the Events API scan to
// a fresh sign-up; older accounts are the catch-up cron's job.
const REPLAY_LOOKBACK_MS = 30 * 60 * 1000;
const REPLAY_PAGE_SIZE = 100;
const REPLAY_MAX_PAGES = 3;

/**
 * Replays this user's recent `user.created` and `user.updated` events from the
 * WorkOS Events API through the webhook's own ingestion, so the profile lands
 * now. The scan reads newest first, so a busy window of other sign-ups can't
 * push a fresh account out of reach, and stops at the account's creation.
 * Returns whether any event was applied.
 */
const replayRecentProfileEvents = async (
  ctx: Pick<ActionCtx, "runMutation">,
  workosUserId: string
): Promise<boolean> => {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!(authKit && apiKey)) {
    return false;
  }
  const workos = createWorkosClient(apiKey, process.env.WORKOS_CLIENT_ID);
  const rangeStart = new Date(Date.now() - REPLAY_LOOKBACK_MS).toISOString();
  const newestFirst: Parameters<typeof ingestWorkosEvent>[1][] = [];
  let after: string | undefined;
  for (let page = 0; page < REPLAY_MAX_PAGES; page++) {
    const result = await workos.events.listEvents({
      events: ["user.created", "user.updated"],
      limit: REPLAY_PAGE_SIZE,
      order: "desc",
      ...(after ? { after } : { rangeStart }),
    });
    for (const event of result.data) {
      if (
        (event.event === "user.created" || event.event === "user.updated") &&
        event.data.id === workosUserId
      ) {
        newestFirst.push(event);
      }
    }
    after = result.listMetadata.after ?? undefined;
    if (
      newestFirst.some((event) => event.event === "user.created") ||
      !after ||
      result.data.length === 0
    ) {
      break;
    }
  }
  let applied = false;
  // Applied oldest first, as the webhook would have delivered them.
  for (const event of newestFirst.reverse()) {
    applied = (await ingestWorkosEvent(ctx, event)) === "applied" || applied;
  }
  return applied;
};

/**
 * `ensureUser` for a browser that has just signed in. When the profile hasn't
 * arrived by webhook yet, it fetches it from WorkOS instead of asking the
 * person to wait and try again. Past `workosProfileReplays` it doesn't ask
 * WorkOS and answers `profile_pending`, as when WorkOS has nothing yet: the
 * app retries, and the webhook lets the next try through.
 */
export const ensureUserNow = action({
  args: {},
  returns: bootstrapResult,
  handler: async (ctx): Promise<BootstrapResult> => {
    const first: BootstrapResult = await ctx.runMutation(
      api.workosBootstrap.ensureUser,
      {}
    );
    if (first.status !== "quarantined" || first.reason !== "profile_pending") {
      return first;
    }
    const identity = await getWorkosBootstrapIdentity(ctx);
    if (!identity) {
      return first;
    }
    const allowed = await rateLimiter.limit(ctx, "workosProfileReplays", {
      key: identity.workosUserId,
      throws: false,
    });
    if (!allowed.ok) {
      console.warn("[workos/bootstrap] profile_replay_rate_limited");
      return first;
    }
    if (!(await replayRecentProfileEvents(ctx, identity.workosUserId))) {
      return first;
    }
    return await ctx.runMutation(api.workosBootstrap.ensureUser, {});
  },
});
