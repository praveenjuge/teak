import { internal } from "@teak/convex/_generated/api";
import { readResponseTextWithinLimit } from "@teak/convex/shared/bounded-response";
import {
  allowedConvexSiteUrl,
  type ConvexRpc,
  type ConvexRpcEnv,
  convexSiteUrls,
  createConvexRpc,
} from "../convexRpc";
import { addressKey } from "../edgeIdentity";
import type { RateLimiter } from "../edgeRateLimit";
import { sha256Hex } from "../lib";

/**
 * WorkOS webhooks arrive here first. WorkOS posts to
 * `/__webhooks/workos/<convex-site-host>`; the Worker checks the request
 * cheaply, queues it on `WORKOS_EVENTS` and answers 200 at once, so a slow
 * or briefly unavailable Convex never makes WorkOS back off. The consumer
 * then posts the exact body and signature to that deployment's own
 * `/workos/webhook` route, which verifies the signature and dedupes events
 * as it always has. The signature is not checked here: the Worker does not
 * hold the webhook secret.
 */

export const WORKOS_WEBHOOK_PATH_PREFIX = "/__webhooks/workos/";
/** Queue messages are limited to 128 KB; this leaves room for the rest. */
export const WORKOS_WEBHOOK_MAX_BODY_BYTES = 120 * 1024;
export const WORKOS_SIGNATURE_MAX_LENGTH = 1024;
/** Signed timestamps further than this from now are refused at the edge. */
export const WORKOS_SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
/**
 * The WorkOS SDK's default tolerance, which Convex's route applies: a
 * signature older than this no longer verifies there.
 */
export const WORKOS_SDK_TOLERANCE_MS = 3 * 60 * 1000;

export interface WorkosEventMessage {
  body: string;
  convexSiteUrl: string;
  receivedAt: number;
  signature: string;
}

export interface WorkosIngressEnv extends ConvexRpcEnv {
  UNKNOWN_CREDENTIAL_LIMITER?: RateLimiter;
  WORKOS_EVENTS?: Queue<unknown>;
}

const text = (status: number, body: string): Response =>
  new Response(body, {
    headers: { "cache-control": "no-store", "content-type": "text/plain" },
    status,
  });

/** The `t=` timestamp (ms) of a `workos-signature` header. */
export const signedAt = (signature: string): number | null => {
  const match = /(?:^|,)\s*t=(\d{1,16})\s*(?:,|$)/u.exec(signature);
  return match ? Number(match[1]) : null;
};

/** The deployment a webhook path names, when this Worker serves it. */
const deploymentFor = (
  env: WorkosIngressEnv,
  pathname: string
): string | null => {
  const host = pathname.slice(WORKOS_WEBHOOK_PATH_PREFIX.length);
  return (
    convexSiteUrls(env).find((origin) => new URL(origin).hostname === host) ??
    null
  );
};

export const handleWorkosWebhookIngress = async (
  request: Request,
  env: WorkosIngressEnv,
  now = Date.now()
): Promise<Response> => {
  if (request.method.toUpperCase() !== "POST") {
    const response = text(405, "Method not allowed");
    response.headers.set("Allow", "POST");
    return response;
  }
  const convexSiteUrl = deploymentFor(env, new URL(request.url).pathname);
  if (!convexSiteUrl) {
    return text(404, "Not found");
  }
  // Every webhook is charged to its address, like an unknown credential.
  if (env.UNKNOWN_CREDENTIAL_LIMITER) {
    try {
      const { success } = await env.UNKNOWN_CREDENTIAL_LIMITER.limit({
        key: addressKey(request),
      });
      if (!success) {
        const response = text(429, "Too many requests");
        response.headers.set("Retry-After", "60");
        return response;
      }
    } catch {
      // An unavailable limiter never blocks WorkOS.
    }
  }
  const signature = request.headers.get("workos-signature");
  const timestamp = signature ? signedAt(signature) : null;
  if (
    !(signature && timestamp !== null) ||
    signature.length > WORKOS_SIGNATURE_MAX_LENGTH ||
    Math.abs(now - timestamp) > WORKOS_SIGNATURE_WINDOW_MS
  ) {
    return text(401, "Invalid signature");
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  ) {
    return text(415, "Expected JSON");
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > WORKOS_WEBHOOK_MAX_BODY_BYTES) {
    return text(413, "Payload too large");
  }
  const body = await readResponseTextWithinLimit(
    new Response(request.body),
    WORKOS_WEBHOOK_MAX_BODY_BYTES
  );
  if (body === null) {
    return text(413, "Payload too large");
  }
  if (!env.WORKOS_EVENTS) {
    return text(503, "Webhook unavailable");
  }
  try {
    await env.WORKOS_EVENTS.send({
      body,
      convexSiteUrl,
      receivedAt: now,
      signature,
    } satisfies WorkosEventMessage);
  } catch (error) {
    console.error("[workos-events] enqueue failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // WorkOS retries a failed delivery.
    return text(503, "Webhook unavailable");
  }
  return text(200, "OK");
};

const parseMessage = (
  env: ConvexRpcEnv,
  body: unknown
): WorkosEventMessage | null => {
  const message = body as Partial<WorkosEventMessage> | null;
  const convexSiteUrl = allowedConvexSiteUrl(env, message?.convexSiteUrl);
  return message &&
    convexSiteUrl &&
    typeof message.body === "string" &&
    typeof message.signature === "string" &&
    typeof message.receivedAt === "number"
    ? {
        body: message.body,
        convexSiteUrl,
        receivedAt: message.receivedAt,
        signature: message.signature,
      }
    : null;
};

/** Convex refused the request for good: a forged or malformed webhook. */
const REFUSED = new Set([400, 401, 403, 413, 415]);
const DELIVERY_TIMEOUT_MS = 30_000;
const MAX_RETRY_DELAY_SECONDS = 15 * 60;

export const retryDelaySeconds = (attempts: number): number =>
  Math.min(MAX_RETRY_DELAY_SECONDS, 30 * 2 ** Math.max(0, attempts - 1));

/** The event's ID and type, for the dead letter; Convex dedupes on the ID. */
export const describeEvent = async (
  body: string
): Promise<{ event: string; eventId: string }> => {
  let parsed: { event?: unknown; id?: unknown } | null = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Unreadable: identified by its digest instead.
  }
  const id = parsed?.id;
  const event = parsed?.event;
  return {
    event: typeof event === "string" && event ? event.slice(0, 64) : "unknown",
    eventId:
      typeof id === "string" && id.length > 0 && id.length <= 256
        ? id
        : `sha256:${await sha256Hex(body)}`,
  };
};

export interface WorkosEventsDeps {
  convex?: (convexSiteUrl: string) => ConvexRpc;
  fetcher?: typeof fetch;
  now?: number;
}

const recordUndeliverable = async (
  env: ConvexRpcEnv,
  message: WorkosEventMessage,
  deps: WorkosEventsDeps
) => {
  const convex =
    deps.convex?.(message.convexSiteUrl) ??
    createConvexRpc(env, message.convexSiteUrl);
  await convex.mutation(
    internal.workosWebhook.recordUndeliverable,
    await describeEvent(message.body)
  );
};

/**
 * Delivers each queued webhook to its deployment. Convex's answer decides:
 * 2xx is done; a refusal is a forged or malformed webhook and is dropped,
 * unless the signature only aged out while the message waited in the queue,
 * which is recorded as undeliverable; anything else is retried with backoff
 * and ends in the dead-letter queue.
 */
export const handleWorkosEventsBatch = async (
  batch: MessageBatch<unknown>,
  env: ConvexRpcEnv,
  deps: WorkosEventsDeps = {}
): Promise<void> => {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now();
  for (const queued of batch.messages) {
    const message = parseMessage(env, queued.body);
    if (!message) {
      console.error("[workos-events] dropped a malformed message");
      queued.ack();
      continue;
    }
    let status: number;
    try {
      const response = await fetcher(
        `${message.convexSiteUrl}/workos/webhook`,
        {
          body: message.body,
          headers: {
            "content-type": "application/json",
            "workos-signature": message.signature,
          },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        }
      );
      status = response.status;
      await response.body?.cancel().catch(() => undefined);
    } catch {
      status = 0;
    }
    if (status >= 200 && status < 300) {
      queued.ack();
      continue;
    }
    if (REFUSED.has(status)) {
      const signed = signedAt(message.signature) ?? 0;
      if (status === 401 && now - signed > WORKOS_SDK_TOLERANCE_MS) {
        // Expired while queued; the hourly WorkOS catch-up replays it.
        try {
          await recordUndeliverable(env, message, deps);
        } catch (error) {
          console.error("[workos-events] dead letter not recorded", {
            error: error instanceof Error ? error.message : String(error),
          });
          queued.retry({ delaySeconds: retryDelaySeconds(queued.attempts) });
          continue;
        }
      } else {
        console.error("[workos-events] Convex refused a webhook", { status });
      }
      queued.ack();
      continue;
    }
    queued.retry({ delaySeconds: retryDelaySeconds(queued.attempts) });
  }
};

/**
 * Webhooks that exhausted their retries: recorded as dead letters in their
 * deployment, so the admin health view shows them. The hourly WorkOS
 * event catch-up applies them from the Events API.
 */
export const handleWorkosEventsDeadLetters = async (
  batch: MessageBatch<unknown>,
  env: ConvexRpcEnv,
  deps: WorkosEventsDeps = {}
): Promise<void> => {
  for (const queued of batch.messages) {
    const message = parseMessage(env, queued.body);
    if (!message) {
      queued.ack();
      continue;
    }
    try {
      await recordUndeliverable(env, message, deps);
      queued.ack();
    } catch (error) {
      console.error("[workos-events] dead letter not recorded", {
        error: error instanceof Error ? error.message : String(error),
      });
      queued.retry({ delaySeconds: 60 });
    }
  }
};
