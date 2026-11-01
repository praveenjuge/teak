import { paginationOptsValidator, type UserIdentity } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  action,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { rateLimiter } from "./shared/rateLimits";
import { workosIssuer } from "./shared/workosApi";
import {
  WORKOS_CLIENT_ID,
  WORKOS_SESSION_ID,
  WORKOS_USER_ID,
  workosDisplayName,
} from "./shared/workosIds";
import {
  listWorkosSessions,
  revokeWorkosSession,
  type WorkosSession,
} from "./workos/sessions";
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

/**
 * What a session's user agent says, as parts each client words in its own
 * language. Browser and system names are product names, so they stay as is;
 * a client shows a value it doesn't know as its generic word.
 */
export interface SessionAgent {
  browser?: "edge" | "firefox" | "chrome" | "safari";
  kind: "browser" | "extension" | "unknown";
  os?: "ipados" | "ios" | "android" | "macos" | "windows" | "linux";
}

const AGENT_BROWSERS: [RegExp, NonNullable<SessionAgent["browser"]>][] = [
  [/Edg\//, "edge"],
  [/Firefox\//, "firefox"],
  [/(?:Chrome|CriOS)\//, "chrome"],
  [/Safari\//, "safari"],
];
const AGENT_SYSTEMS: [RegExp, NonNullable<SessionAgent["os"]>][] = [
  [/iPad/, "ipados"],
  [/iPhone|iPod/, "ios"],
  [/Android/, "android"],
  [/Macintosh|Mac OS X/, "macos"],
  [/Windows/, "windows"],
  [/Linux/, "linux"],
];

export function describeSessionAgent(
  agent: string | null | undefined
): SessionAgent {
  if (!agent) {
    return { kind: "unknown" };
  }
  if (agent.startsWith("Teak Browser")) {
    return { kind: "extension" };
  }
  const browser = AGENT_BROWSERS.find(([pattern]) => pattern.test(agent))?.[1];
  const os = AGENT_SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];
  return {
    kind: "browser",
    ...(browser ? { browser } : {}),
    ...(os ? { os } : {}),
  };
}

const BROWSER_NAMES: Record<NonNullable<SessionAgent["browser"]>, string> = {
  edge: "Edge",
  firefox: "Firefox",
  chrome: "Chrome",
  safari: "Safari",
};
const SYSTEM_NAMES: Record<NonNullable<SessionAgent["os"]>, string> = {
  ipados: "iPadOS",
  ios: "iOS",
  android: "Android",
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

/** The English name clients that predate `agent` still show. */
export function sessionDisplayName(agent: SessionAgent): string {
  if (agent.kind === "unknown") {
    return "Unknown device";
  }
  if (agent.kind === "extension") {
    return "Teak browser extension";
  }
  const browser = agent.browser ? BROWSER_NAMES[agent.browser] : "Browser";
  return agent.os ? `${browser} on ${SYSTEM_NAMES[agent.os]}` : browser;
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

interface SessionUser {
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

const displayValidator = v.object({
  id: v.string(),
  name: v.string(),
  agent: v.optional(
    v.object({
      kind: v.union(
        v.literal("browser"),
        v.literal("extension"),
        v.literal("unknown")
      ),
      browser: v.optional(v.string()),
      os: v.optional(v.string()),
    })
  ),
  signedInAt: v.number(),
  lastActiveAt: v.optional(v.number()),
  current: v.boolean(),
});

interface DisplaySession {
  agent?: SessionAgent;
  current: boolean;
  id: string;
  lastActiveAt?: number;
  name: string;
  signedInAt: number;
}

/** A session as Settings lists it; `lastActiveAt` only once it moved on. */
export function displaySession(
  session: WorkosSession,
  currentSessionId: string
): DisplaySession {
  const agent = describeSessionAgent(session.userAgent);
  return {
    id: session.id,
    name: sessionDisplayName(agent),
    agent,
    signedInAt: session.createdAt,
    ...(session.updatedAt !== undefined && session.updatedAt > session.createdAt
      ? { lastActiveAt: session.updatedAt }
      : {}),
    current: session.id === currentSessionId,
  };
}

const isLiveSession = (session: WorkosSession) =>
  session.status === "active" && session.expiresAt > Date.now();

const sessionPageValidator = v.object({
  page: v.array(displayValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

function workosSessionApiKey() {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    throw new Error("Device service is unavailable. Please try again.");
  }
  return apiKey;
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

export const listAuthkitSessions = action({
  args: { paginationOpts: paginationOptsValidator },
  returns: sessionPageValidator,
  handler: async (
    ctx,
    { paginationOpts }
  ): Promise<{
    page: DisplaySession[];
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
    const apiKey = workosSessionApiKey();
    await chargeWorkosRequest(ctx, user.teakUserId);
    const result = await listWorkosSessions(user.workosUserId, apiKey, {
      limit: Math.max(1, Math.min(Math.floor(paginationOpts.numItems), 100)),
      after: cursor || undefined,
    });
    const next = result.after ?? "";
    if (next && (!WORKOS_SESSION_ID.test(next) || next === cursor)) {
      throw new Error("Device service returned an invalid page.");
    }
    return {
      page: result.sessions
        .filter(isLiveSession)
        .map((session) => displaySession(session, user.sessionId)),
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
    const apiKey = workosSessionApiKey();
    if (sessionId === user.sessionId) {
      await chargeWorkosRequest(ctx, user.teakUserId);
      await revokeWorkosSession(sessionId, apiKey);
      return null;
    }
    let after: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      await chargeWorkosRequest(ctx, user.teakUserId);
      const result = await listWorkosSessions(user.workosUserId, apiKey, {
        limit: 100,
        after,
      });
      const target = result.sessions.find(
        (session) => session.id === sessionId
      );
      if (target) {
        if (target.status !== "active" || target.expiresAt <= Date.now()) {
          return null;
        }
        await chargeWorkosRequest(ctx, user.teakUserId);
        await revokeWorkosSession(sessionId, apiKey);
        return null;
      }
      const next = result.after;
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

const MAX_OTHER_SESSION_PAGES = 20;
// Leaves room in the per-minute WorkOS budget for the list pages and for
// Settings to list devices again afterwards.
const MAX_OTHER_SESSION_REVOKES = 20;

/**
 * Signs out every live session of this account except the one making the
 * call. Revokes at most 20 per call; `hasMore` says some are left, which a
 * later call (after the rate limit refills) finishes.
 */
export const revokeOtherAuthkitSessions = action({
  args: {},
  returns: v.object({ revokedCount: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      throw new Error("Please sign in again.");
    }
    const apiKey = workosSessionApiKey();
    const others: string[] = [];
    let after: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < MAX_OTHER_SESSION_PAGES; page++) {
      await chargeWorkosRequest(ctx, user.teakUserId);
      const result = await listWorkosSessions(user.workosUserId, apiKey, {
        limit: 100,
        after,
      });
      for (const session of result.sessions) {
        if (isLiveSession(session) && session.id !== user.sessionId) {
          others.push(session.id);
        }
      }
      const next = result.after;
      if (!next) {
        break;
      }
      if (!WORKOS_SESSION_ID.test(next) || seen.has(next)) {
        throw new Error("Device service returned an invalid page.");
      }
      seen.add(next);
      after = next;
    }
    let revokedCount = 0;
    for (const sessionId of others.slice(0, MAX_OTHER_SESSION_REVOKES)) {
      if (sessionId === user.sessionId) {
        continue;
      }
      await chargeWorkosRequest(ctx, user.teakUserId);
      await revokeWorkosSession(sessionId, apiKey);
      revokedCount += 1;
    }
    return {
      revokedCount,
      hasMore: others.length > MAX_OTHER_SESSION_REVOKES,
    };
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
