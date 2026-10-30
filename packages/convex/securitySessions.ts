import { NotFoundException, type Session } from "@workos-inc/node";
import { paginationOptsValidator, type UserIdentity } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  type ActionCtx,
  action,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { rateLimiter } from "./shared/rateLimits";
import { workosIssuer } from "./shared/workosApi";
import { createWorkosClient } from "./shared/workosClient";
import {
  WORKOS_CLIENT_ID,
  WORKOS_SESSION_ID,
  WORKOS_USER_ID,
} from "./shared/workosIds";
import {
  type ResolveArgs,
  type ResolvedOwner,
  resolveOwner,
} from "./workosIdentity";
import type { ProviderProfile } from "./workosProfileRead";

function readWorkosSessionClaims(
  identity: UserIdentity | null,
  clientId: string
) {
  if (
    !(WORKOS_CLIENT_ID.test(clientId) && identity) ||
    identity.issuer !== workosIssuer(clientId) ||
    !WORKOS_USER_ID.test(identity.subject) ||
    typeof identity.sid !== "string" ||
    !WORKOS_SESSION_ID.test(identity.sid)
  ) {
    return null;
  }
  return { workosUserId: identity.subject, sessionId: identity.sid };
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

function sessionDisplayName(agent: string | null | undefined): string {
  if (!agent) {
    return "Unknown device";
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
type SessionCtx =
  | Pick<ActionCtx, "auth" | "runQuery">
  | Pick<QueryCtx, "auth" | "runQuery" | "db">;

type ActionResolved =
  | { status: "ok"; teakUserId: string }
  | { status: "denied"; reason: string };

async function resolveOwnerFor(
  ctx: SessionCtx,
  args: ResolveArgs
): Promise<ResolvedOwner | ActionResolved> {
  return "db" in ctx && ctx.db
    ? await resolveOwner(ctx, args)
    : await ctx.runQuery(internal.workosIdentity.resolveWorkosOwner, args);
}

export const identityMapping = internalQuery({
  args: { teakUserId: v.string() },
  handler: (ctx, { teakUserId }) =>
    ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
      .unique(),
});

export const readWorkosProfile = (
  ctx: Pick<ActionCtx, "runQuery">,
  workosUserId: string
) => ctx.runQuery(internal.workosProfileRead.getProfile, { workosUserId });

export const readComponentUser = (
  ctx: Pick<QueryCtx, "runQuery">,
  workosUserId: string
) =>
  ctx.runQuery(components.workOSAuthKit.lib.getAuthUser, { id: workosUserId });

export async function resolveStoredUserId(
  ctx: SessionCtx,
  ownerId: string
): Promise<TeakUserId | null> {
  const row =
    "db" in ctx && ctx.db
      ? await ctx.db
          .query("users")
          .withIndex("by_teakUserId", (q) => q.eq("teakUserId", ownerId))
          .unique()
      : await ctx.runQuery(internal.securitySessions.identityMapping, {
          teakUserId: ownerId,
        });
  if (!row?.workosUserId) {
    return null;
  }
  const owner = await resolveOwnerFor(ctx, {
    workosUserId: row.workosUserId,
    verification: { kind: "connect" },
  });
  return owner.status === "ok" && owner.teakUserId === ownerId
    ? (owner.teakUserId as TeakUserId)
    : null;
}

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
  profile?: ProviderProfile;
  sessionId: string;
  teakUserId: TeakUserId;
  workosUserId: string;
}

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
  const owner = await resolveOwnerFor(ctx, {
    workosUserId: principal.workosUserId,
    verification: { kind: "session", emailVerified: principal.emailVerified },
  });
  return owner.status === "ok"
    ? {
        workosUserId: principal.workosUserId,
        teakUserId: owner.teakUserId as TeakUserId,
        identity,
        sessionId: principal.sessionId,
        ...("profile" in owner ? { profile: owner.profile } : {}),
      }
    : null;
}

// The one error a signed-out call gets. The Apple app treats the
// UNAUTHENTICATED code as signed out.
export const UNAUTHENTICATED_ERROR = {
  code: "UNAUTHENTICATED",
  message: "User must be authenticated",
} as const;

export async function requireSessionUser(ctx: SessionCtx) {
  const user = await getSessionUser(ctx);
  if (!user) {
    throw new ConvexError(UNAUTHENTICATED_ERROR);
  }
  return user;
}

export async function requireSessionUserId(
  ctx: SessionCtx
): Promise<TeakUserId> {
  return (await requireSessionUser(ctx)).teakUserId;
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
  const provider =
    sessionUser.profile ??
    (await readWorkosProfile(ctx, sessionUser.identity.subject));
  if (!provider) {
    return null;
  }
  return {
    teakUserId: sessionUser.teakUserId,
    user: {
      _id: sessionUser.teakUserId,
      email: provider.email,
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

// Settings shows its own text for any failure; the code and message are the
// public API's for too many requests.
async function chargeWorkosRequest(ctx: ActionCtx, teakUserId: string) {
  const limit = await rateLimiter.limit(ctx, "workosSessionRequests", {
    key: teakUserId,
    throws: false,
  });
  if (!limit.ok) {
    throw new ConvexError({
      code: "RATE_LIMITED",
      message: "Too many requests",
      retryAt: Date.now() + limit.retryAfter,
    });
  }
}

function validateProviderSession(session: Session, userId: string) {
  if (
    session.userId !== userId ||
    !WORKOS_SESSION_ID.test(session.id) ||
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
    if (cursor && !WORKOS_SESSION_ID.test(cursor)) {
      throw new Error("Invalid device page. Please refresh.");
    }
    const client = workosSessionClient();
    await chargeWorkosRequest(ctx, user.teakUserId);
    const result = await client.listSessions(user.identity.subject, {
      limit: Math.max(1, Math.min(Math.floor(paginationOpts.numItems), 100)),
      after: cursor,
      order: "desc",
    });
    for (const session of result.data) {
      validateProviderSession(session, user.identity.subject);
    }
    const next = result.listMetadata.after ?? "";
    if (next && (!WORKOS_SESSION_ID.test(next) || next === cursor)) {
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
    if (!WORKOS_SESSION_ID.test(sessionId)) {
      throw new Error("Invalid device session.");
    }
    const client = workosSessionClient();
    if (sessionId === user.sessionId) {
      await chargeWorkosRequest(ctx, user.teakUserId);
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
      await chargeWorkosRequest(ctx, user.teakUserId);
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
          return null;
        }
        await chargeWorkosRequest(ctx, user.teakUserId);
        await client.revokeSession({ sessionId });
        return null;
      }
      const next = result.listMetadata.after;
      if (!next) {
        throw new Error("Device session was not found.");
      }
      if (!WORKOS_SESSION_ID.test(next) || seen.has(next)) {
        throw new Error("Device service returned an invalid page.");
      }
      seen.add(next);
      after = next;
    }
    throw new Error("Could not verify this device. Please contact support.");
  },
});

export async function getDeletionRetryPrincipal(ctx: SessionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }
  const claims = readWorkosSessionIdentity(
    identity,
    process.env.WORKOS_CLIENT_ID ?? ""
  );
  return claims ? { workosUserId: claims.workosUserId } : null;
}
