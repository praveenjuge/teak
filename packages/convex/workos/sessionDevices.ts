/**
 * Settings' list of signed-in devices: AuthKit sessions read and revoked
 * through WorkOS, and how each is shown. `securitySessions.ts` registers the
 * actions; identity stays there.
 */
import { ConvexError, v } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { rateLimiter } from "../rateLimiter";
import type { SessionUser } from "../securitySessions";
import { WORKOS_SESSION_CURSOR, WORKOS_SESSION_ID } from "../shared/workosIds";
import { isWorkosApiConfigured } from "./client";
import {
  listWorkosSessions,
  revokeWorkosSession,
  type WorkosSession,
} from "./sessions";

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

export const sessionPageValidator = v.object({
  page: v.array(displayValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

function assertDeviceServiceConfigured() {
  if (!isWorkosApiConfigured()) {
    throw new Error("Device service is unavailable. Please try again.");
  }
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

export interface SessionPage {
  continueCursor: string;
  isDone: boolean;
  page: DisplaySession[];
}

export const listDeviceSessions = async (
  ctx: ActionCtx,
  user: SessionUser,
  paginationOpts: { cursor: string | null; numItems: number }
): Promise<SessionPage> => {
  const cursor = paginationOpts.cursor;
  if (cursor && !WORKOS_SESSION_CURSOR.test(cursor)) {
    throw new Error("Invalid device page. Please refresh.");
  }
  assertDeviceServiceConfigured();
  await chargeWorkosRequest(ctx, user.teakUserId);
  const result = await listWorkosSessions(user.workosUserId, {
    limit: Math.max(1, Math.min(Math.floor(paginationOpts.numItems), 100)),
    after: cursor || undefined,
  });
  const next = result.after ?? "";
  return {
    page: result.sessions
      .filter(isLiveSession)
      .map((session) => displaySession(session, user.sessionId)),
    isDone: !next,
    continueCursor: next,
  };
};

export const revokeDeviceSession = async (
  ctx: ActionCtx,
  user: SessionUser,
  sessionId: string
): Promise<void> => {
  if (!WORKOS_SESSION_ID.test(sessionId)) {
    throw new Error("Invalid device session.");
  }
  assertDeviceServiceConfigured();
  if (sessionId === user.sessionId) {
    await chargeWorkosRequest(ctx, user.teakUserId);
    await revokeWorkosSession(sessionId);
    return;
  }
  let after: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    await chargeWorkosRequest(ctx, user.teakUserId);
    const result = await listWorkosSessions(user.workosUserId, {
      limit: 100,
      after,
    });
    const target = result.sessions.find((session) => session.id === sessionId);
    if (target) {
      if (target.status !== "active" || target.expiresAt <= Date.now()) {
        return;
      }
      await chargeWorkosRequest(ctx, user.teakUserId);
      await revokeWorkosSession(sessionId);
      return;
    }
    const next = result.after;
    if (!next) {
      throw new Error("Device session was not found.");
    }
    if (seen.has(next)) {
      throw new Error("Device service returned an invalid page.");
    }
    seen.add(next);
    after = next;
  }
  throw new Error("Could not verify this device. Please contact support.");
};

const MAX_OTHER_SESSION_PAGES = 20;
// Leaves room in the per-minute WorkOS budget for the list pages and for
// Settings to list devices again afterwards.
const MAX_OTHER_SESSION_REVOKES = 20;

export const revokeOtherDeviceSessions = async (
  ctx: ActionCtx,
  user: SessionUser
): Promise<{ hasMore: boolean; revokedCount: number }> => {
  assertDeviceServiceConfigured();
  const others: string[] = [];
  let after: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < MAX_OTHER_SESSION_PAGES; page++) {
    await chargeWorkosRequest(ctx, user.teakUserId);
    const result = await listWorkosSessions(user.workosUserId, {
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
    // `listWorkosSessions` checks the cursor's format; this only stops a loop.
    if (seen.has(next)) {
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
    await revokeWorkosSession(sessionId);
    revokedCount += 1;
  }
  return {
    revokedCount,
    hasMore: others.length > MAX_OTHER_SESSION_REVOKES,
  };
};
