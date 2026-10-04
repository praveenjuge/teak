import { paginationOptsValidator, type UserIdentity } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  type ActionCtx,
  env,
  internalQuery,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";

import { validWorkosExternalId } from "./workosTokens";

// Convex has already verified this JWT through auth.config.ts. These checks bind
// its claims to the session provider; live session revocation is still required.
export function readWorkosSessionIdentity(
  identity: UserIdentity | null,
  clientId: string
): {
  workosUserId: string;
  externalId?: string | null;
  sessionId: string;
  emailVerified: true;
} | null {
  if (
    !(/^client_[A-Za-z0-9]+$/.test(clientId) && identity) ||
    identity.issuer !== `https://api.workos.com/user_management/${clientId}` ||
    !/^user_[A-Za-z0-9]+$/.test(identity.subject) ||
    typeof identity.sid !== "string" ||
    !/^session_[A-Za-z0-9]+$/.test(identity.sid) ||
    identity.emailVerified !== true ||
    !validWorkosExternalId(identity.external_id)
  ) {
    return null;
  }
  return {
    workosUserId: identity.subject,
    sessionId: identity.sid,
    emailVerified: true,
    ...(identity.external_id === undefined
      ? {}
      : { externalId: identity.external_id }),
  };
}

interface SessionRecord {
  _id: string;
  createdAt: number;
  expiresAt: number;
  userAgent?: string | null;
  userId: string;
}

export function sessionDisplayName(agent: string | null | undefined): string {
  if (!agent) {
    return "Unknown device";
  }
  if (agent.startsWith("Teak Desktop")) {
    return "Teak Desktop";
  }
  if (agent.startsWith("Teak Safari")) {
    return "Teak Safari";
  }
  if (agent.startsWith("Teak Browser")) {
    return "Teak browser extension";
  }
  const browsers: [RegExp, string][] = [
    [/Edg\//, "Edge"],
    [/Firefox\//, "Firefox"],
    [/(?:Chrome|CriOS)\//, "Chrome"],
    [/Safari\//, "Safari"],
  ];
  const platforms: [RegExp, string][] = [
    [/iPad/, "iPadOS"],
    [/iPhone|iPod/, "iOS"],
    [/Android/, "Android"],
    [/Macintosh|Mac OS X/, "macOS"],
    [/Windows/, "Windows"],
    [/Linux/, "Linux"],
  ];
  const browser =
    browsers.find(([pattern]) => pattern.test(agent))?.[1] ?? "Browser";
  const platform = platforms.find(([pattern]) => pattern.test(agent))?.[1];
  return platform ? `${browser} on ${platform}` : browser;
}

export type TeakUserId = string & { readonly __brand: "TeakUserId" };
type SessionCtx = Pick<ActionCtx, "auth" | "runQuery">;

export const identityMapping = internalQuery({
  args: { teakUserId: v.string() },
  handler: (ctx, { teakUserId }) =>
    ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
      .unique(),
});

// Provider profile reads stay at the same boundary as provider identities.
export const readWorkosProfile = (
  ctx: Pick<QueryCtx, "runQuery">,
  workosUserId: string
) =>
  ctx.runQuery(components.workOSAuthKit.lib.getAuthUser, { id: workosUserId });

// API keys keep their permanent Teak owner in both modes. Under WorkOS they
// still require the same mapped, verified and undeleted vault boundary.
export async function resolveWorkosApiKeyOwner(
  ctx: Pick<ActionCtx, "runQuery">,
  ownerId: string
): Promise<TeakUserId | null> {
  const row = await ctx.runQuery(internal.securitySessions.identityMapping, {
    teakUserId: ownerId,
  });
  if (!row?.workosUserId) {
    return null;
  }
  const owner:
    | { status: "ok"; teakUserId: string }
    | { status: "denied"; reason: string } = await ctx.runQuery(
    internal.workosIdentity.resolveWorkosOwner,
    {
      workosUserId: row.workosUserId,
      externalId: ownerId,
      verification: { kind: "connect" },
    }
  );
  return owner.status === "ok" ? (owner.teakUserId as TeakUserId) : null;
}

// Read-only in queries and actions. Shadow mode retains the legacy owner;
// enforcement is a separate operator gate after one clean production week.
export async function resolveStoredUserId(
  ctx: SessionCtx,
  ownerId: string
): Promise<TeakUserId | null> {
  const row = await ctx.runQuery(internal.securitySessions.identityMapping, {
    teakUserId: ownerId,
  });
  let reason: string | null = null;
  if (!row) {
    reason = "missing_mapping";
  } else if (row.deletedAt !== undefined) {
    reason = "deleted_user";
  }
  if (reason) {
    console.warn("identity_resolver_mismatch", {
      provider: "betterauth",
      reason,
    });
  }
  const enforce = env.IDENTITY_RESOLVER_ENFORCE;
  if (enforce !== undefined && enforce !== "false" && enforce !== "true") {
    throw new Error("IDENTITY_RESOLVER_ENFORCE must be true or false.");
  }
  if (enforce === "true" && reason) {
    return null;
  }
  return ownerId as TeakUserId;
}

export function resolveTeakUserId(ctx: SessionCtx, identity: UserIdentity) {
  return resolveStoredUserId(ctx, identity.subject);
}

// Internal/API jobs carry the permanent ID across a serialization boundary.
// Revalidate and brand it here before invoking ownership helpers.
export async function requireTeakUserId(
  ctx: SessionCtx,
  ownerId: string
): Promise<TeakUserId> {
  const resolved = await resolveStoredUserId(ctx, ownerId);
  if (!resolved) {
    throw new Error("User identity mapping unavailable");
  }
  return resolved;
}

async function liveSession(
  ctx: SessionCtx,
  identity: UserIdentity
): Promise<SessionRecord | null> {
  if (typeof identity.sessionId !== "string") {
    return null;
  }
  const session = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "session",
    where: [
      { field: "_id", value: identity.sessionId },
      { field: "userId", value: identity.subject },
    ],
  })) as SessionRecord | null;
  return session && session.expiresAt > Date.now() ? session : null;
}

// A single raw identity read feeds mapping and live-session validation.
// Component session reads keep revocation reactive for existing subscriptions.
export async function getSessionUser(ctx: SessionCtx) {
  let identity: UserIdentity | null;
  try {
    identity = await ctx.auth.getUserIdentity();
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthenticated") {
      return null;
    }
    throw error;
  }
  if (!identity) {
    return null;
  }
  const session = await liveSession(ctx, identity);
  if (!session) {
    return null;
  }
  const teakUserId = await resolveTeakUserId(ctx, identity);
  return teakUserId ? { teakUserId, identity, session } : null;
}

export async function getSessionProfile(ctx: SessionCtx) {
  const sessionUser = await getSessionUser(ctx);
  if (!sessionUser) {
    return null;
  }
  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", value: sessionUser.teakUserId }],
  });
  return user ? { user, teakUserId: sessionUser.teakUserId } : null;
}

export async function currentSession(ctx: SessionCtx) {
  const user = await getSessionUser(ctx);
  return user ? { ...user.session, teakUserId: user.teakUserId } : null;
}

const displayValidator = v.object({
  id: v.string(),
  name: v.string(),
  signedInAt: v.number(),
  current: v.boolean(),
});

export const listSessions = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(displayValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    const current = await currentSession(ctx);
    if (!current) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "session",
      where: [{ field: "userId", value: current.userId }],
      paginationOpts: {
        ...paginationOpts,
        numItems: Math.min(paginationOpts.numItems, 100),
      },
    });
    const display = (session: SessionRecord) => ({
      id: session._id,
      name: sessionDisplayName(session.userAgent),
      signedInAt: session.createdAt,
      current: session._id === current._id,
    });
    return {
      page: [
        ...(paginationOpts.cursor ? [] : [display(current)]),
        ...(result.page as SessionRecord[])
          .filter(
            (session) =>
              session.expiresAt > Date.now() && session._id !== current._id
          )
          .map(display),
      ],
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const revokeSession = mutation({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const current = await currentSession(ctx);
    if (!current) {
      throw new Error("Please sign in again.");
    }
    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: "session",
        where: [
          { field: "_id", value: sessionId },
          { field: "userId", value: current.userId },
        ],
      },
    });
    return null;
  },
});

// Phase R transport probe: exposes no vault or mapping access.
export async function getReadinessIdentity(ctx: Pick<ActionCtx, "auth">) {
  if (env.WORKOS_ENVIRONMENT_ID !== "environment_01KBYSVN9RVQ1JXACG3MDMQZGA") {
    return null;
  }
  const user = await ctx.auth.getUserIdentity();
  if (
    !user ||
    typeof user.sid !== "string" ||
    !user.sid.startsWith("session_") ||
    user.issuer !==
      "https://api.workos.com/user_management/client_01KBYSVNVDV2G39REZFGF0K7GD"
  ) {
    return null;
  }
  return {
    subject: user.subject,
    issuer: user.issuer,
    externalId: typeof user.external_id === "string" ? user.external_id : null,
    emailVerified: user.email_verified === true,
    sid: user.sid,
  };
}
