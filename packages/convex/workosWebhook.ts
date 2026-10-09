import type { HttpRouter } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  type ActionCtx,
  env,
  httpAction,
  internalMutation,
} from "./_generated/server";
import { readResponseTextWithinLimit } from "./shared/boundedResponse";
import { authKit } from "./workosAuthKit";
import { INVALID_WORKOS_EVENT, parseWorkosEvent } from "./workosLifecycle";

// One transaction: the component stores the provider profile and Teak links
// owners and records deletions. Either both commit or neither does, so WorkOS
// (or the Events API catch-up) can safely retry.
export const syncVerifiedEvent = internalMutation({
  args: {
    id: v.string(),
    createdAt: v.string(),
    event: v.union(
      v.literal("user.created"),
      v.literal("user.updated"),
      v.literal("user.deleted")
    ),
    data: v.record(v.string(), v.any()),
    context: v.optional(v.record(v.string(), v.any())),
  },
  returns: v.null(),
  handler: async (ctx, event) => {
    // Teak's checks run first, so a payload it can never apply is dead-lettered
    // instead of failing in the component's validators. The component then
    // stores the profile, so Teak's linking reads this same event's state.
    parseWorkosEvent(event);
    await ctx.runMutation(components.workOSAuthKit.lib.onWebhookEvent, {
      event: {
        id: event.id,
        createdAt: event.createdAt,
        event: event.event,
        data: event.data,
        ...(event.context === undefined ? {} : { context: event.context }),
      },
    });
    await ctx.runMutation(internal.workosLifecycle.applyWorkosEvent, {
      id: event.id,
      createdAt: event.createdAt,
      event: event.event,
      data: event.data,
    });
    return null;
  },
});

// The mutation's argument validators would reject these before Teak's own
// checks run, so the envelope is checked here and dead-lettered the same way.
const isRecord = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const envelopeProblem = (event: {
  id: unknown;
  createdAt: unknown;
  data: unknown;
  context?: unknown;
}): string | undefined => {
  if (
    typeof event.id !== "string" ||
    event.id.length === 0 ||
    event.id.length > 256
  ) {
    return "Invalid WorkOS event id";
  }
  if (typeof event.createdAt !== "string") {
    return "Invalid WorkOS event timestamp";
  }
  if (!isRecord(event.data)) {
    return "Invalid WorkOS event data";
  }
  // Only a truthy context is forwarded to the mutation.
  if (event.context && !isRecord(event.context)) {
    return "Invalid WorkOS event context";
  }
  return undefined;
};

// Dead letters are unique per provider event. An ID that can't be stored as is
// (too long, or not a string) is keyed by its SHA-256 instead of truncated.
const deadLetterKey = async (id: unknown) => {
  if (typeof id === "string" && id.length > 0 && id.length <= 256) {
    return id;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(id) ?? String(id))
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `sha256:${hex}`;
};

// The one way a verified provider event reaches Teak, used by the webhook and
// the Events API catch-up. A payload Teak can never apply is dead-lettered and
// reported as "rejected"; any other failure throws and stays retryable.
export const ingestWorkosEvent = async (
  ctx: Pick<ActionCtx, "runMutation">,
  event: {
    id: unknown;
    createdAt: unknown;
    event: "user.created" | "user.updated" | "user.deleted";
    data: unknown;
    context?: unknown;
  }
): Promise<"applied" | "rejected"> => {
  const problem = envelopeProblem(event);
  if (problem) {
    await ctx.runMutation(internal.workosWebhook.recordDeadLetter, {
      eventId: await deadLetterKey(event.id),
      event: event.event,
      reason: problem,
    });
    return "rejected";
  }
  try {
    await ctx.runMutation(internal.workosWebhook.syncVerifiedEvent, {
      id: event.id as string,
      createdAt: event.createdAt as string,
      event: event.event,
      data: event.data as Record<string, unknown>,
      ...(event.context
        ? { context: event.context as Record<string, unknown> }
        : {}),
    });
    return "applied";
  } catch (error) {
    if (
      error instanceof ConvexError &&
      (error.data as { code?: unknown })?.code === INVALID_WORKOS_EVENT
    ) {
      await ctx.runMutation(internal.workosWebhook.recordDeadLetter, {
        eventId: await deadLetterKey(event.id),
        event: event.event,
        reason: String(
          (error.data as { message?: unknown }).message ?? INVALID_WORKOS_EVENT
        ).slice(0, 128),
      });
      return "rejected";
    }
    throw error;
  }
};

export const workosWebhook = httpAction(async (ctx, request) => {
  const kit = authKit;
  const secret = env.WORKOS_WEBHOOK_SECRET;
  if (!(kit && secret)) {
    return new Response("Webhook unavailable", { status: 503 });
  }
  const signature = request.headers.get("workos-signature");
  if (!signature || signature.length > 1024) {
    return new Response("Invalid signature", { status: 401 });
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim() !==
    "application/json"
  ) {
    return new Response("Expected JSON", { status: 415 });
  }
  const payload = await readResponseTextWithinLimit(
    new Response(request.body),
    256 * 1024
  );
  if (payload === null) {
    return new Response("Payload too large", { status: 413 });
  }
  let event: Awaited<ReturnType<typeof kit.workos.webhooks.constructEvent>>;
  try {
    // Verify the exact body with the official SDK before deserialization.
    event = await kit.workos.webhooks.constructEvent({
      payload,
      sigHeader: signature,
      secret,
    });
  } catch {
    return new Response("Invalid webhook", { status: 401 });
  }
  if (
    event.event !== "user.created" &&
    event.event !== "user.updated" &&
    event.event !== "user.deleted"
  ) {
    return new Response("Ignored", { status: 200 });
  }
  try {
    const outcome = await ingestWorkosEvent(ctx, event);
    return new Response(outcome === "rejected" ? "Rejected" : "OK", {
      status: 200,
    });
  } catch {
    // Neither store committed, so WorkOS retries. Never expose provider data,
    // signing material or mutation error details.
    return new Response("Webhook processing failed", { status: 500 });
  }
});

export const recordDeadLetter = internalMutation({
  args: { eventId: v.string(), event: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workosWebhookDeadLetters")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .first();
    if (!existing) {
      await ctx.db.insert("workosWebhookDeadLetters", {
        ...args,
        receivedAt: Date.now(),
      });
      // The event is acknowledged and the catch-up moves past it, so this line
      // is the only signal that an operator needs to look.
      console.error("workos_event_dead_lettered", {
        event: args.event,
        reason: args.reason,
      });
    }
    return null;
  },
});

// The registration Action (signup freeze), verified on the exact body like the
// webhook. The component's own route checks re-serialized JSON instead.
export const workosAction = httpAction(async (ctx, request) => {
  const kit = authKit;
  const secret = env.WORKOS_ACTION_SECRET;
  if (!(kit && secret)) {
    return new Response("Action unavailable", { status: 503 });
  }
  const signature = request.headers.get("workos-signature");
  if (!signature || signature.length > 1024) {
    return new Response("Invalid signature", { status: 401 });
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim() !==
    "application/json"
  ) {
    return new Response("Expected JSON", { status: 415 });
  }
  const payload = await readResponseTextWithinLimit(
    new Response(request.body),
    64 * 1024
  );
  if (payload === null) {
    return new Response("Payload too large", { status: 413 });
  }
  let action: Awaited<ReturnType<typeof kit.workos.actions.constructAction>>;
  try {
    action = await kit.workos.actions.constructAction({
      payload,
      sigHeader: signature,
      secret,
    });
  } catch {
    return new Response("Invalid action", { status: 401 });
  }
  const verdict = await ctx.runMutation(internal.workosAuthKit.authKitAction, {
    action,
  });
  const signed = await kit.workos.actions.signResponse(verdict, secret);
  return new Response(JSON.stringify(signed), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

// Teak serves the component's two provider routes itself, verifying each on
// the exact request body.
export const registerWorkosRoutes = (http: HttpRouter) => {
  if (!authKit) {
    return;
  }
  http.route({
    path: "/workos/webhook",
    method: "POST",
    handler: workosWebhook,
  });
  http.route({ path: "/workos/action", method: "POST", handler: workosAction });
};
