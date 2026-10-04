import { type HttpRouter, httpRouter } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { env, httpAction, internalMutation } from "./_generated/server";
import { readinessAuthKit } from "./migration/workosReadiness";
import { readResponseTextWithinLimit } from "./shared/boundedResponse";

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
  },
  returns: v.null(),
  handler: async (ctx, event) => {
    await ctx.runMutation(internal.workosLifecycle.applyWorkosEvent, {
      id: event.id,
      createdAt: event.createdAt,
      event: event.event,
      data: event.data,
    });
    await ctx.runMutation(components.workOSAuthKit.lib.onWebhookEvent, {
      event,
    });
    return null;
  },
});

export const workosWebhook = httpAction(async (ctx, request) => {
  const kit = readinessAuthKit;
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
  } catch {
    // A retryable response preserves delivery until both stores have committed.
    // Do not expose provider data, signing material or mutation error details.
    return new Response("Webhook processing failed", { status: 500 });
  }
  return new Response("OK", { status: 200 });
});

export const registerWorkosRoutes = (http: HttpRouter) => {
  if (!readinessAuthKit) {
    return;
  }
  const providerRoutes = httpRouter();
  readinessAuthKit.registerRoutes(providerRoutes);
  for (const [path, method, handler] of providerRoutes.getRoutes()) {
    http.route({
      path,
      method,
      // Keep the component's signed registration Action route intact.
      handler: path === "/workos/webhook" ? workosWebhook : handler,
    });
  }
};
