import { type HttpRouter, httpRouter } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { env, httpAction, internalMutation } from "./_generated/server";
import { readResponseTextWithinLimit } from "./shared/boundedResponse";
import { authKit } from "./workosAuthKit";
import { INVALID_WORKOS_EVENT } from "./workosLifecycle";

// This transaction preserves Teak processing even when component synchronization
// deduplicates, rewrites or suppresses its own callback. Either both commit or
// neither commits, so WorkOS can safely retry a failed delivery.
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
    replay: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, event) => {
    await ctx.runMutation(internal.workosLifecycle.applyWorkosEvent, {
      id: event.id,
      createdAt: event.createdAt,
      event: event.event,
      data: event.data,
      ...(event.replay === undefined ? {} : { replay: event.replay }),
    });
    await ctx.runMutation(components.workOSAuthKit.lib.onWebhookEvent, {
      event: {
        id: event.id,
        createdAt: event.createdAt,
        event: event.event,
        data: event.data,
        ...(event.context === undefined ? {} : { context: event.context }),
      },
    });
    return null;
  },
});

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
    await ctx.runMutation(internal.workosWebhook.syncVerifiedEvent, {
      id: event.id,
      createdAt: event.createdAt,
      event: event.event,
      data: event.data,
      ...(event.context ? { context: event.context } : {}),
    });
  } catch (error) {
    // Neither store committed. A payload Teak can never apply is recorded and
    // acknowledged so WorkOS stops retrying it; anything else stays retryable.
    // Do not expose provider data, signing material or mutation error details.
    if (
      error instanceof ConvexError &&
      (error.data as { code?: unknown })?.code === INVALID_WORKOS_EVENT
    ) {
      await ctx.runMutation(internal.workosWebhook.recordDeadLetter, {
        eventId: String(event.id).slice(0, 256),
        event: event.event,
        reason: String(
          (error.data as { message?: unknown }).message ?? INVALID_WORKOS_EVENT
        ).slice(0, 128),
      });
      return new Response("Rejected", { status: 200 });
    }
    return new Response("Webhook processing failed", { status: 500 });
  }
  return new Response("OK", { status: 200 });
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

// Teak verifies both provider routes on the exact request body.
const providerHandler = <T>(path: string, componentHandler: T) => {
  if (path === "/workos/webhook") {
    return workosWebhook;
  }
  if (path === "/workos/action") {
    return workosAction;
  }
  return componentHandler;
};

export const registerWorkosRoutes = (http: HttpRouter) => {
  if (!authKit) {
    return;
  }
  const providerRoutes = httpRouter();
  authKit.registerRoutes(providerRoutes);
  for (const [path, method, handler] of providerRoutes.getRoutes()) {
    http.route({
      path,
      method,
      handler: providerHandler(path, handler),
    });
  }
};
