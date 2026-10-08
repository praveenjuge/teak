import { NotFoundException, type Session } from "@workos-inc/node";
import { paginationOptsValidator, type UserIdentity } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  type ActionCtx,
  action,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { workosIssuer } from "./shared/workosApi";
import { createWorkosClient } from "./shared/workosClient";
import { validWorkosExternalId } from "./workosTokens";

// Convex has already verified this JWT through auth.config.ts. These checks bind
// its claims to the session provider; live session revocation is still required.
function readWorkosSessionClaims(
  identity: UserIdentity | null,
  clientId: string
) {
  if (
    !(/^client_[A-Za-z0-9]+$/.test(clientId) && identity) ||
    identity.issuer !== workosIssuer(clientId) ||
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

// Convex passes customJwt claims through raw, so AuthKit's verification claim
// arrives as `email_verified`; the OIDC-normalized `emailVerified` is never set.
const workosEmailVerified = (identity: UserIdentity | null) =>
  identity?.email_verified === true;

export function readWorkosSessionIdentity(
  identity: UserIdentity | null,
  clientId: string
) {
  const claims = readWorkosSessionClaims(identity, clientId);
  return claims && workosEmailVerified(identity)
    ? { ...claims, emailVerified: true as const }
    : null;
}

// Bootstrap can return verify_email before a mapping exists. It never grants vault access.
export async function getWorkosBootstrapIdentity(ctx: Pick<ActionCtx, "auth">) {
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
        emailVerified: workosEmailVerified(identity),
      }
    : null;
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
) => ctx.runQuery(internal.workosProfileRead.getProfile, { workosUserId });

// The WorkOS AuthKit component's copy of a provider user, looked up by the
// WorkOS user ID Teak already mapped. It is never a session identity.
export const readComponentUser = (
  ctx: Pick<QueryCtx, "runQuery">,
  workosUserId: string
) =>
  ctx.runQuery(components.workOSAuthKit.lib.getAuthUser, { id: workosUserId });

// API keys and internal jobs carry the permanent Teak owner. It still has to
// map to a verified, undeleted WorkOS user.
export async function resolveStoredUserId(
  ctx: SessionCtx,
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

export async function resolveTeakUserId(
  ctx: SessionCtx,
  identity: UserIdentity
): Promise<TeakUserId | null> {
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

interface SessionUser {
  identity: UserIdentity;
  sessionId: string;
  teakUserId: TeakUserId;
  workosUserId: string;
}

// AuthKit session tokens are verified by Convex and stay valid until their
// five-minute TTL. Ownership and deletion checks stay reactive through the
// canonical resolver.
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
        workosUserId: principal.workosUserId,
        teakUserId,
        identity,
        sessionId: principal.sessionId,
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
  const provider = await readWorkosProfile(ctx, sessionUser.identity.subject);
  const mirror = await ctx.runQuery(internal.securitySessions.identityMapping, {
    teakUserId: sessionUser.teakUserId,
  });
  // Match the REST profile policy: email is the WorkOS-synced mirror, while
  // display fields come from the canonical provider profile.
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

const displayValidator = v.object({
  id: v.string(),
  name: v.string(),
  signedInAt: v.number(),
  current: v.boolean(),
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
  return createWorkosClient(apiKey, process.env.WORKOS_CLIENT_ID)
    .userManagement;
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
    if (!user) {
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
    if (!user) {
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

// This proves only that the caller may acknowledge an existing deletion. It is
// never used to admit a new request or authorize vault access.
export async function getDeletionRetryPrincipal(ctx: SessionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }
  const claims = readWorkosSessionIdentity(
    identity,
    process.env.WORKOS_CLIENT_ID ?? ""
  );
  return claims
    ? { workosUserId: claims.workosUserId, externalId: claims.externalId }
    : null;
}
