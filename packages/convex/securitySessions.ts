import { NotFoundException, type Session, WorkOS } from "@workos-inc/node";
import { paginationOptsValidator, type UserIdentity } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  type ActionCtx,
  action,
  env,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

import { readAuthPrimary } from "./env";
import { validWorkosExternalId } from "./workosTokens";

// Convex has already verified this JWT through auth.config.ts. These checks bind
// its claims to the session provider; live session revocation is still required.
function readWorkosSessionClaims(
  identity: UserIdentity | null,
  clientId: string
) {
  if (
    !(/^client_[A-Za-z0-9]+$/.test(clientId) && identity) ||
    identity.issuer !== `https://api.workos.com/user_management/${clientId}` ||
    !/^user_[A-Za-z0-9]+$/.test(identity.subject) ||
    typeof identity.sid !== "string" ||
    !/^session_[A-Za-z0-9]+$/.test(identity.sid) ||
    !validWorkosExternalId(identity.external_id) ||
    (typeof identity.external_id === "string" &&
      /[\s\p{Cc}]/u.test(identity.external_id))
  ) {
    return null;
  }
  return {
    workosUserId: identity.subject,
    sessionId: identity.sid,
    ...(identity.external_id === undefined
      ? {}
      : { externalId: identity.external_id }),
  };
}

export function readWorkosSessionIdentity(
  identity: UserIdentity | null,
  clientId: string
) {
  const claims = readWorkosSessionClaims(identity, clientId);
  return claims && identity?.emailVerified === true
    ? { ...claims, emailVerified: true as const }
    : null;
}

// Bootstrap can return verify_email before a mapping exists. It never grants vault access.
export async function getWorkosBootstrapIdentity(ctx: Pick<ActionCtx, "auth">) {
  if (readAuthPrimary() !== "workos") {
    return null;
  }
  let identity: UserIdentity | null;
  try {
    identity = await ctx.auth.getUserIdentity();
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthenticated") {
      return null;
    }
    throw error;
  }
  const claims = readWorkosSessionClaims(
    identity,
    process.env.WORKOS_CLIENT_ID ?? ""
  );
  return claims
    ? {
        ...claims,
        email: typeof identity?.email === "string" ? identity.email : null,
        emailVerified: identity?.emailVerified === true,
      }
    : null;
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
  ctx: Pick<ActionCtx, "runQuery">,
  workosUserId: string
) =>
  ctx.runQuery(internal.workosProfileRead.getProfile, { workosUserId });

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
  if (readAuthPrimary() === "workos") {
    return resolveWorkosApiKeyOwner(ctx, ownerId);
  }
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

const isBetterAuthIdentity = (identity: UserIdentity) =>
  Boolean(env.CONVEX_SITE_URL) && identity.issuer === env.CONVEX_SITE_URL;

export async function resolveTeakUserId(
  ctx: SessionCtx,
  identity: UserIdentity
): Promise<TeakUserId | null> {
  if (readAuthPrimary() === "betterauth") {
    return isBetterAuthIdentity(identity)
      ? resolveStoredUserId(ctx, identity.subject)
      : null;
  }
  const principal = readWorkosSessionIdentity(
    identity,
    process.env.WORKOS_CLIENT_ID ?? ""
  );
  if (!principal) {
    return null;
  }
  const owner:
    | { status: "ok"; teakUserId: string }
    | { status: "denied"; reason: string } = await ctx.runQuery(
    internal.workosIdentity.resolveWorkosOwner,
    {
      workosUserId: principal.workosUserId,
      ...(principal.externalId === undefined
        ? {}
        : { externalId: principal.externalId }),
      verification: { kind: "session", emailVerified: principal.emailVerified },
    }
  );
  return owner.status === "ok" ? (owner.teakUserId as TeakUserId) : null;
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

type SessionUser = {
  teakUserId: TeakUserId;
  identity: UserIdentity;
  sessionId: string;
} & (
  | { provider: "betterauth"; session: SessionRecord }
  | { provider: "workos"; workosUserId: string }
);

// Better Auth component reads keep revocation reactive. AuthKit session tokens
// are verified by Convex and remain valid until their configured five-minute TTL.
// WorkOS ownership/deletion checks remain reactive through the canonical resolver.
export async function getSessionUser(
  ctx: SessionCtx
): Promise<SessionUser | null> {
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
  if (readAuthPrimary() === "workos") {
    const principal = readWorkosSessionIdentity(
      identity,
      process.env.WORKOS_CLIENT_ID ?? ""
    );
    if (!principal) {
      return null;
    }
    const teakUserId = await resolveTeakUserId(ctx, identity);
    return teakUserId
      ? {
          provider: "workos",
          workosUserId: principal.workosUserId,
          teakUserId,
          identity,
          sessionId: principal.sessionId,
        }
      : null;
  }
  if (!isBetterAuthIdentity(identity)) {
    return null;
  }
  const session = await liveSession(ctx, identity);
  if (!session) {
    return null;
  }
  const teakUserId = await resolveTeakUserId(ctx, identity);
  return teakUserId
    ? {
        provider: "betterauth",
        teakUserId,
        identity,
        session,
        sessionId: session._id,
      }
    : null;
}

interface SessionProfile {
  teakUserId: TeakUserId;
  user: {
    _id: string;
    email: string;
    emailVerified: boolean;
    name?: string | null;
    image?: string | null;
  };
}

export async function getSessionProfile(
  ctx: SessionCtx
): Promise<SessionProfile | null> {
  const sessionUser = await getSessionUser(ctx);
  if (!sessionUser) {
    return null;
  }
  if (sessionUser.provider === "workos") {
    const provider = await readWorkosProfile(ctx, sessionUser.identity.subject);
    const mirror = await ctx.runQuery(
      internal.securitySessions.identityMapping,
      {
        teakUserId: sessionUser.teakUserId,
      }
    );
    // Match the REST profile policy: email is the WorkOS-synced mirror, while
    // display fields come from the canonical provider profile. Never fall back to BA.
    if (!provider || typeof mirror?.workosEmail !== "string") {
      return null;
    }
    return {
      teakUserId: sessionUser.teakUserId,
      user: {
        _id: sessionUser.teakUserId,
        email: mirror.workosEmail,
        emailVerified: provider.emailVerified,
        name:
          provider.name ??
          ([provider.firstName, provider.lastName].filter(Boolean).join(" ") ||
            null),
        image: provider.profilePictureUrl ?? null,
      },
    };
  }
  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", value: sessionUser.teakUserId }],
  });
  return user ? { user, teakUserId: sessionUser.teakUserId } : null;
}

export async function currentSession(ctx: SessionCtx) {
  const user = await getSessionUser(ctx);
  return user?.provider === "betterauth"
    ? { ...user.session, teakUserId: user.teakUserId }
    : null;
}

const displayValidator = v.object({
  id: v.string(),
  name: v.string(),
  signedInAt: v.number(),
  current: v.boolean(),
});

export const listSessions = query({
  args: {
    paginationOpts: paginationOptsValidator,
    // Operational cache key only; ownership always comes from the live session.
    retryKey: v.optional(v.string()),
  },
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

const sessionPageValidator = v.object({
  page: v.array(displayValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

function workosSessionClient() {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    throw new Error("Device service is unavailable. Please try again.");
  }
  return new WorkOS(apiKey, {
    clientId: process.env.WORKOS_CLIENT_ID,
    maxRetries: 0,
    timeout: 10_000,
  }).userManagement;
}

function validateProviderSession(session: Session, userId: string) {
  if (
    session.userId !== userId ||
    !/^session_[A-Za-z0-9]+$/.test(session.id) ||
    !["active", "expired", "revoked"].includes(session.status) ||
    !Number.isFinite(Date.parse(session.createdAt)) ||
    !Number.isFinite(Date.parse(session.expiresAt))
  ) {
    throw new Error("Device service returned an invalid session.");
  }
}

export const listAuthkitSessions = action({
  args: { paginationOpts: paginationOptsValidator },
  returns: sessionPageValidator,
  handler: async (
    ctx,
    { paginationOpts }
  ): Promise<{
    page: { id: string; name: string; signedInAt: number; current: boolean }[];
    isDone: boolean;
    continueCursor: string;
  }> => {
    const user = await getSessionUser(ctx);
    if (user?.provider !== "workos") {
      throw new Error("Please sign in again.");
    }
    const cursor = paginationOpts.cursor;
    if (cursor && !/^session_[A-Za-z0-9]+$/.test(cursor)) {
      throw new Error("Invalid device page. Please refresh.");
    }
    const result = await workosSessionClient().listSessions(
      user.identity.subject,
      {
        limit: Math.max(1, Math.min(Math.floor(paginationOpts.numItems), 100)),
        after: cursor,
        order: "desc",
      }
    );
    for (const session of result.data) {
      validateProviderSession(session, user.identity.subject);
    }
    const next = result.listMetadata.after ?? "";
    if (next && (!/^session_[A-Za-z0-9]+$/.test(next) || next === cursor)) {
      throw new Error("Device service returned an invalid page.");
    }
    return {
      page: result.data
        .filter(
          (session) =>
            session.status === "active" &&
            Date.parse(session.expiresAt) > Date.now()
        )
        .map((session) => ({
          id: session.id,
          name: sessionDisplayName(session.userAgent),
          signedInAt: Date.parse(session.createdAt),
          current: session.id === user.sessionId,
        })),
      isDone: !next,
      continueCursor: next,
    };
  },
});

export const revokeAuthkitSession = action({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const user = await getSessionUser(ctx);
    if (user?.provider !== "workos") {
      throw new Error("Please sign in again.");
    }
    if (!/^session_[A-Za-z0-9]+$/.test(sessionId)) {
      throw new Error("Invalid device session.");
    }
    const client = workosSessionClient();
    if (sessionId === user.sessionId) {
      // The exact verified AuthKit sid proves ownership even after active-only listing omits it.
      try {
        await client.revokeSession({ sessionId });
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          throw error;
        }
      }
      return null;
    }
    let after: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const result = await client.listSessions(user.identity.subject, {
        limit: 100,
        after,
      });
      for (const session of result.data) {
        validateProviderSession(session, user.identity.subject);
      }
      const target = result.data.find((session) => session.id === sessionId);
      if (target) {
        if (
          target.status !== "active" ||
          Date.parse(target.expiresAt) <= Date.now()
        ) {
          // Ownership is proven above. A retry after a lost response must finish sign-out.
          return null;
        }
        await client.revokeSession({ sessionId });
        return null;
      }
      const next = result.listMetadata.after;
      if (!next) {
        throw new Error("Device session was not found.");
      }
      if (!/^session_[A-Za-z0-9]+$/.test(next) || seen.has(next)) {
        throw new Error("Device service returned an invalid page.");
      }
      seen.add(next);
      after = next;
    }
    throw new Error("Could not verify this device. Please contact support.");
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
