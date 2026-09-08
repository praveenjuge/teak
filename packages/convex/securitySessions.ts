import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { type ActionCtx, mutation, query } from "./_generated/server";

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

// Check the live session as well as the signed JWT. A revoked session must not
// use a cached JWT to inspect or revoke other credentials.
export async function currentSession(
  ctx: Pick<ActionCtx, "auth" | "runQuery">
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || typeof identity.sessionId !== "string") {
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

// Reuse the same live-session check for all device-authenticated data APIs.
// Query callers also subscribe to the session row, so revocation invalidates
// their existing subscriptions without waiting for the signed JWT to expire.
export async function getSessionIdentity(
  ctx: Pick<ActionCtx, "auth" | "runQuery">
) {
  if (!(await currentSession(ctx))) {
    return null;
  }
  return ctx.auth.getUserIdentity();
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
