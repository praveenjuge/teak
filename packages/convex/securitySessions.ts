import { paginationOptsValidator, type UserIdentity } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  action,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { workosIssuer } from "./shared/workosApi";
import {
  WORKOS_CLIENT_ID,
  WORKOS_SESSION_ID,
  WORKOS_USER_ID,
  workosDisplayName,
} from "./shared/workosIds";
import {
  listDeviceSessions,
  revokeDeviceSession,
  revokeOtherDeviceSessions,
  type SessionPage,
  sessionPageValidator,
} from "./workos/sessionDevices";
import {
  type ResolveArgs,
  type ResolvedOwner,
  resolveOwner,
  resolveStoredOwner,
} from "./workosIdentity";

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

// The JWT template adds the WorkOS name as `name`, `first_name` and
// `last_name`.
const workosClaimName = (identity: UserIdentity | null) =>
  workosDisplayName(identity?.name, identity?.first_name, identity?.last_name);

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
        name: workosClaimName(identity),
      }
    : null;
}

export type TeakUserId = string & { readonly __brand: "TeakUserId" };
type SessionCtx =
  | Pick<ActionCtx, "auth" | "runQuery">
  | Pick<QueryCtx, "auth" | "runQuery" | "db">;

async function resolveOwnerFor(
  ctx: SessionCtx,
  args: ResolveArgs
): Promise<ResolvedOwner> {
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

export async function resolveStoredUserId(
  ctx: SessionCtx,
  ownerId: string
): Promise<TeakUserId | null> {
  const owner =
    "db" in ctx && ctx.db
      ? await resolveStoredOwner(ctx, ownerId)
      : await ctx.runQuery(internal.workosIdentity.resolveStoredWorkosOwner, {
          teakUserId: ownerId,
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

export interface SessionUser {
  identity: UserIdentity;
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

const readOwnerRow = (ctx: SessionCtx, teakUserId: string) =>
  "db" in ctx && ctx.db
    ? ctx.db
        .query("users")
        .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
        .unique()
    : ctx.runQuery(internal.securitySessions.identityMapping, { teakUserId });

export async function getSessionProfile(
  ctx: SessionCtx
): Promise<SessionProfile | null> {
  const sessionUser = await getSessionUser(ctx);
  if (!sessionUser) {
    return null;
  }
  // The session's signed claims are the newest copy of the WorkOS profile;
  // the owner row holds what sign-in last stored.
  const { identity, teakUserId } = sessionUser;
  const claimEmail = typeof identity.email === "string" ? identity.email : null;
  const claimName = workosClaimName(identity);
  // A token from the JWT template always carries the address, and the name
  // whenever WorkOS has one; only an older token needs the row.
  const row = claimEmail ? null : await readOwnerRow(ctx, teakUserId);
  const email = claimEmail ?? row?.email;
  if (!email) {
    return null;
  }
  return {
    teakUserId,
    user: {
      _id: teakUserId,
      email,
      emailVerified: true,
      name: claimEmail ? claimName : (row?.name ?? null),
      image: null,
    },
  };
}

/** The signed-in user the device actions act for. */
const requireDeviceUser = async (ctx: ActionCtx) => {
  const user = await getSessionUser(ctx);
  if (!user) {
    throw new Error("Please sign in again.");
  }
  return user;
};

// Settings' devices list. The WorkOS calls live in workos/sessionDevices.ts;
// these keep the function paths the web app calls.
export const listAuthkitSessions = action({
  args: { paginationOpts: paginationOptsValidator },
  returns: sessionPageValidator,
  handler: async (ctx, { paginationOpts }): Promise<SessionPage> =>
    listDeviceSessions(ctx, await requireDeviceUser(ctx), paginationOpts),
});

export const revokeAuthkitSession = action({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    await revokeDeviceSession(ctx, await requireDeviceUser(ctx), sessionId);
    return null;
  },
});

/**
 * Signs out every live session of this account except the one making the
 * call. Revokes at most 20 per call; `hasMore` says some are left, which a
 * later call (after the rate limit refills) finishes.
 */
export const revokeOtherAuthkitSessions = action({
  args: {},
  returns: v.object({ revokedCount: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) =>
    revokeOtherDeviceSessions(ctx, await requireDeviceUser(ctx)),
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
