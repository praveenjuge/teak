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

export const WORKOS_WEBHOOK_PATH_PREFIX = "/__webhooks/workos/";
/** Queue messages are limited to 128 KB; this leaves room for the rest. */
export const WORKOS_WEBHOOK_MAX_BODY_BYTES = 120 * 1024;
export const WORKOS_SIGNATURE_MAX_LENGTH = 1024;
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

export const signedAt = (signature: string): number | null => {
  const match = /(?:^|,)\s*t=(\d{1,16})\s*(?:,|$)/u.exec(signature);
  return match ? Number(match[1]) : null;
};

const withinUnknownCredentialLimit = async (
  request: Request,
  env: WorkosIngressEnv
): Promise<boolean> => {
  if (!env.UNKNOWN_CREDENTIAL_LIMITER) {
    return true;
  }
  try {
    const { success } = await env.UNKNOWN_CREDENTIAL_LIMITER.limit({
      key: addressKey(request),
    });
    return success;
  } catch {
    return true;
  }
};

const parseEventFields = (
  body: string
): { event?: unknown; id?: unknown } | null => {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

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
  if (!(await withinUnknownCredentialLimit(request, env))) {
    const response = text(429, "Too many requests");
    response.headers.set("Retry-After", "60");
    return response;
  }
  const signature = request.headers.get("workos-signature");
  const timestamp = signature ? signedAt(signature) : null;
  if (
    !(signature && timestamp !== null) ||
    signature.length > WORKOS_SIGNATURE_MAX_LENGTH ||
    now - timestamp > WORKOS_SDK_TOLERANCE_MS ||
    timestamp - now > WORKOS_SIGNATURE_WINDOW_MS
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

const REFUSED = new Set([400, 401, 403, 413, 415]);
const DELIVERY_TIMEOUT_MS = 30_000;
const MAX_RETRY_DELAY_SECONDS = 15 * 60;

export const retryDelaySeconds = (attempts: number): number =>
  Math.min(MAX_RETRY_DELAY_SECONDS, 30 * 2 ** Math.max(0, attempts - 1));

export const describeEvent = async (
  body: string
): Promise<{ event: string; eventId: string }> => {
  const parsed = parseEventFields(body);
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
  const { recorded } = await convex.action(
    internal.workosWebhook.recordUndeliverableWebhook,
    { body: message.body, signature: message.signature }
  );
  if (!recorded) {
    console.error("[workos-events] dropped an unverifiable webhook", {
      ...(await describeEvent(message.body)),
    });
  }
};

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
          redirect: "manual",
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
