import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const businessEventValidator = v.union(
  v.literal("user.created"),
  v.literal("card.created")
);

const BUSINESS_EVENT_MESSAGES = {
  "user.created": "teak.user.created",
  "card.created": "teak.card.created",
} as const;

type BusinessEvent = keyof typeof BUSINESS_EVENT_MESSAGES;

interface BusinessEventArgs {
  cardId?: string;
  cardType?: string;
  event: BusinessEvent;
  surface?: string;
  userId?: string;
}

interface SchedulerCtx {
  scheduler: {
    runAfter: (...args: any[]) => unknown;
  };
}

const parseDsn = (rawDsn: string) => {
  const url = new URL(rawDsn);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const projectId = pathParts[pathParts.length - 1];
  if (!projectId) {
    throw new Error("Invalid Sentry DSN: missing project id");
  }

  const basePath = pathParts.slice(0, -1).join("/");
  const pathPrefix = basePath ? `/${basePath}` : "";

  return {
    dsn: rawDsn,
    endpoint: `${url.origin}${pathPrefix}/api/${projectId}/envelope/`,
  };
};

const createEventId = (): string => crypto.randomUUID().split("-").join("");

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const resolveEnvironment = (): string =>
  process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";

const resolveRelease = (): string | undefined =>
  process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA;

const resolveDsn = (): string | undefined =>
  (process.env.SENTRY_DSN ?? process.env.SENTRY_API_DSN)?.trim();

const buildTags = async (args: BusinessEventArgs) => ({
  event: args.event,
  surface: args.surface ?? "convex",
  cardType: args.cardType ?? null,
  environment: resolveEnvironment(),
  release: resolveRelease() ?? null,
  userIdHash: args.userId ? await sha256(args.userId) : null,
  cardIdHash: args.cardId ? await sha256(args.cardId) : null,
});

export const scheduleBusinessEvent = (
  ctx: SchedulerCtx,
  args: BusinessEventArgs
): unknown =>
  ctx.scheduler.runAfter(
    0,
    (internal as any).sentry.captureBusinessEvent,
    args
  );

export const captureBusinessEvent = internalAction({
  args: {
    event: businessEventValidator,
    userId: v.optional(v.string()),
    cardId: v.optional(v.string()),
    cardType: v.optional(v.string()),
    surface: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const rawDsn = resolveDsn();
    if (!rawDsn) {
      return { sent: false, reason: "missing_dsn" as const };
    }

    const parsedDsn = parseDsn(rawDsn);
    const message = BUSINESS_EVENT_MESSAGES[args.event];
    const timestamp = new Date().toISOString();
    const eventId = createEventId();
    const event = {
      event_id: eventId,
      timestamp,
      platform: "javascript",
      level: "info",
      message,
      environment: resolveEnvironment(),
      release: resolveRelease(),
      tags: await buildTags(args),
      fingerprint: [message],
    };

    const envelope = [
      JSON.stringify({ dsn: parsedDsn.dsn, sent_at: timestamp }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");

    const response = await fetch(parsedDsn.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope,
    });

    if (!response.ok) {
      throw new Error(`Sentry business event failed: ${response.status}`);
    }

    return { sent: true as const };
  },
});
