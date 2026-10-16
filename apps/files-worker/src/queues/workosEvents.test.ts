import { describe, expect, test } from "bun:test";
import { createConvexRpc } from "../convexRpc";
import worker, { type Env } from "../index";
import {
  createFakeConvex,
  fakeConvexEnv,
  TEST_CONVEX_SITE_URL,
} from "../test/fakeConvex";
import { createFakeBatch, createFakeQueue } from "../test/fakeQueue";
import {
  handleWorkosEventsBatch,
  handleWorkosEventsDeadLetters,
  handleWorkosWebhookIngress,
  WORKOS_WEBHOOK_MAX_BODY_BYTES,
  type WorkosEventMessage,
} from "./workosEvents";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const HOST = new URL(TEST_CONVEX_SITE_URL).hostname;
const BODY = JSON.stringify({ event: "user.updated", id: "evt_1" });

const webhook = (
  overrides: {
    body?: string;
    headers?: Record<string, string>;
    host?: string;
    method?: string;
  } = {}
) =>
  new Request(
    `https://files.teakvault.com/__webhooks/workos/${overrides.host ?? HOST}`,
    {
      body: overrides.method === "GET" ? undefined : (overrides.body ?? BODY),
      headers: {
        "cf-connecting-ip": "203.0.113.9",
        "content-type": "application/json",
        "workos-signature": `t=${String(NOW - 1000)}, v1=abc`,
        ...overrides.headers,
      },
      method: overrides.method ?? "POST",
    }
  );

const ingressEnv = (
  options: { failSend?: boolean; limited?: boolean } = {}
) => {
  const queue = createFakeQueue(options);
  const charged: string[] = [];
  return {
    charged,
    env: {
      ...fakeConvexEnv,
      UNKNOWN_CREDENTIAL_LIMITER: {
        limit: ({ key }: { key: string }) => {
          charged.push(key);
          return Promise.resolve({ success: !options.limited });
        },
      },
      WORKOS_EVENTS: queue.queue,
    },
    sent: queue.sent,
  };
};

describe("WorkOS webhook ingress", () => {
  test("queues a well-formed webhook for its deployment and answers at once", async () => {
    const { charged, env, sent } = ingressEnv();
    const response = await handleWorkosWebhookIngress(webhook(), env, NOW);
    expect(response.status).toBe(200);
    expect(charged).toEqual(["ip:203.0.113.9"]);
    expect(sent).toEqual([
      {
        body: {
          body: BODY,
          convexSiteUrl: TEST_CONVEX_SITE_URL,
          receivedAt: NOW,
          signature: `t=${String(NOW - 1000)}, v1=abc`,
        },
        delaySeconds: undefined,
      },
    ]);
  });

  test.each([
    ["an unknown deployment", { host: "other.convex.site" }, 404],
    ["a GET", { method: "GET" }, 405],
    ["no signature", { headers: { "workos-signature": "" } }, 401],
    [
      // Convex's verifier would already refuse it as too old.
      "a signature older than three minutes",
      { headers: { "workos-signature": `t=${String(NOW - 181_000)}, v1=abc` } },
      401,
    ],
    [
      "a signature more than five minutes ahead",
      { headers: { "workos-signature": `t=${String(NOW + 301_000)}, v1=abc` } },
      401,
    ],
    [
      "an oversized signature",
      {
        headers: {
          "workos-signature": `t=${String(NOW)}, v1=${"a".repeat(1100)}`,
        },
      },
      401,
    ],
    ["a non-JSON body", { headers: { "content-type": "text/plain" } }, 415],
    [
      "a body over the queue's limit",
      { body: `"${"a".repeat(WORKOS_WEBHOOK_MAX_BODY_BYTES)}"` },
      413,
    ],
  ] as const)(
    "refuses %s without queueing it",
    async (_name, overrides, status) => {
      const { env, sent } = ingressEnv();
      const response = await handleWorkosWebhookIngress(
        webhook(overrides as Parameters<typeof webhook>[0]),
        env,
        NOW
      );
      expect(response.status).toBe(status);
      expect(sent).toEqual([]);
    }
  );

  test("charges every webhook to its address and refuses past the limit", async () => {
    const { env, sent } = ingressEnv({ limited: true });
    const response = await handleWorkosWebhookIngress(webhook(), env, NOW);
    expect(response.status).toBe(429);
    expect(sent).toEqual([]);
  });

  test("the Worker routes webhooks here before any signed-file handling", async () => {
    const { env, sent } = ingressEnv();
    const response = await worker.fetch(
      webhook({
        headers: { "workos-signature": `t=${String(Date.now())}, v1=abc` },
      }),
      env as unknown as Env,
      { waitUntil: () => undefined } as unknown as ExecutionContext
    );
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  test("asks WorkOS to retry when the queue is unavailable", async () => {
    const { env } = ingressEnv({ failSend: true });
    expect((await handleWorkosWebhookIngress(webhook(), env, NOW)).status).toBe(
      503
    );
  });
});

const queued = (
  overrides: Partial<WorkosEventMessage> = {}
): WorkosEventMessage => ({
  body: BODY,
  convexSiteUrl: TEST_CONVEX_SITE_URL,
  receivedAt: NOW,
  signature: `t=${String(NOW - 1000)}, v1=abc`,
  ...overrides,
});

const deliverWith = async (
  status: number | "network",
  options: { attempts?: number; messages?: unknown[]; now?: number } = {}
) => {
  const posts: Array<{ body: string; headers: Headers; url: string }> = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    posts.push({
      body: String(init?.body),
      headers: new Headers(init?.headers),
      url: String(input),
    });
    if (status === "network") {
      return Promise.reject(new Error("connection reset"));
    }
    return Promise.resolve(new Response("", { status }));
  }) as typeof fetch;
  const convex = createFakeConvex({
    "workosWebhook:recordUndeliverableWebhook": () => ({ recorded: true }),
  });
  const { batch, settled } = createFakeBatch(
    "teak-workos-events",
    options.messages ?? [queued()],
    options.attempts
  );
  await handleWorkosEventsBatch(batch, fakeConvexEnv, {
    convex: (url) => createConvexRpc(fakeConvexEnv, url, convex.fetcher),
    fetcher,
    now: options.now ?? NOW,
  });
  return { convex, posts, settled };
};

describe("WorkOS event delivery", () => {
  test("posts the exact body and signature to the deployment's webhook route", async () => {
    const { posts, settled } = await deliverWith(200);
    expect(settled[0]?.outcome).toBe("ack");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(`${TEST_CONVEX_SITE_URL}/workos/webhook`);
    expect(posts[0]?.body).toBe(BODY);
    expect(posts[0]?.headers.get("workos-signature")).toBe(
      `t=${String(NOW - 1000)}, v1=abc`
    );
    expect(posts[0]?.headers.get("content-type")).toBe("application/json");
  });

  test.each([400, 401, 403, 413, 415])(
    "drops a webhook Convex refuses with %i",
    async (status) => {
      const { convex, settled } = await deliverWith(status);
      expect(settled[0]?.outcome).toBe("ack");
      expect(convex.calls).toEqual([]);
    }
  );

  test.each([500, 502, 503, "network"] as const)(
    "retries with growing delays after %s",
    async (status) => {
      const first = await deliverWith(status, { attempts: 1 });
      const third = await deliverWith(status, { attempts: 3 });
      expect(first.settled[0]).toMatchObject({
        outcome: "retry",
        retryDelaySeconds: 30,
      });
      expect(third.settled[0]).toMatchObject({
        outcome: "retry",
        retryDelaySeconds: 120,
      });
    }
  );

  test("asks Convex to verify and record a webhook whose signature aged out in the queue", async () => {
    const { convex, settled } = await deliverWith(401, {
      now: NOW + 10 * 60 * 1000,
    });
    expect(settled[0]?.outcome).toBe("ack");
    expect(
      convex.callsTo("workosWebhook:recordUndeliverableWebhook")
    ).toMatchObject([
      {
        args: { body: BODY, signature: `t=${String(NOW - 1000)}, v1=abc` },
        kind: "action",
      },
    ]);
  });

  test("drops messages for deployments this Worker does not serve", async () => {
    const { posts, settled } = await deliverWith(200, {
      messages: [queued({ convexSiteUrl: "https://elsewhere.convex.site" })],
    });
    expect(settled[0]?.outcome).toBe("ack");
    expect(posts).toEqual([]);
  });
});

describe("WorkOS events dead letters", () => {
  test("hands each undeliverable webhook to its deployment to verify and record", async () => {
    const convex = createFakeConvex({
      // The second one's signature doesn't verify.
      "workosWebhook:recordUndeliverableWebhook": (args) => ({
        recorded: args.body === BODY,
      }),
    });
    const { batch, outcomes } = createFakeBatch("teak-workos-events-dlq", [
      queued(),
      queued({ body: "{not json" }),
    ]);
    await handleWorkosEventsDeadLetters(batch, fakeConvexEnv, {
      convex: (url) => createConvexRpc(fakeConvexEnv, url, convex.fetcher),
    });
    expect(outcomes()).toEqual(["ack", "ack"]);
    expect(
      convex
        .callsTo("workosWebhook:recordUndeliverableWebhook")
        .map((call) => call.args.body)
    ).toEqual([BODY, "{not json"]);
  });

  test("retries a dead letter Convex could not record", async () => {
    const convex = createFakeConvex({
      "workosWebhook:recordUndeliverableWebhook": () => {
        throw new Error("database busy");
      },
    });
    const { batch, outcomes } = createFakeBatch("teak-workos-events-dlq", [
      queued(),
    ]);
    await handleWorkosEventsDeadLetters(batch, fakeConvexEnv, {
      convex: (url) => createConvexRpc(fakeConvexEnv, url, convex.fetcher),
    });
    expect(outcomes()).toEqual(["retry"]);
  });
});
