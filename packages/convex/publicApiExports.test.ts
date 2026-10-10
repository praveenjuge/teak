/// <reference types="vite/client" />
import polarTest from "@convex-dev/polar/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import counterTest from "@convex-dev/sharded-counter/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "export-owner";

// Hold the scheduled export workflow; these tests cover the HTTP contract.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  polarTest.register(t);
  workflowTest.register(t);
  workosTest.register(t);
  rateLimiterTest.register(t, "rateLimiterV2");
  apiKeysTest.register(t);
  counterTest.register(t, "apiKeys/shardedCounter");
  const workosUserId = await seedWorkosOwner(t, OWNER);
  const client = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_exports",
    email_verified: true,
    external_id: OWNER,
  });
  const key = await client.mutation(api.apiKeys.createUserApiKey, {
    name: "Exports",
  });
  const request = (method: "GET" | "POST", path: string) =>
    t.fetch(path, {
      method,
      headers: { Authorization: `Bearer ${key.key}` },
    });
  return { t, request };
}

test("export endpoints require a credential", async () => {
  const { t } = await setup();
  expect((await t.fetch("/v1/exports/latest")).status).toBe(401);
  expect((await t.fetch("/v1/exports", { method: "POST" })).status).toBe(401);
});

test("starts one export at a time and reports it as the latest", async () => {
  const { request } = await setup();
  const empty = await request("GET", "/v1/exports/latest");
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({
    job: null,
    canStartNew: true,
    nextAvailableAt: null,
  });

  const started = await request("POST", "/v1/exports");
  expect(started.status).toBe(202);
  const { job } = await started.json();
  expect(job).toMatchObject({ status: "pending", downloadUrl: null });

  const again = await request("POST", "/v1/exports");
  expect(again.status).toBe(409);
  expect(await again.json()).toMatchObject({
    code: "CONFLICT",
    job: { id: job.id },
  });

  const latest = await (await request("GET", "/v1/exports/latest")).json();
  expect(latest).toMatchObject({ canStartNew: false, job: { id: job.id } });
});

test("refuses a second export within 7 days and says when it can run", async () => {
  const { t, request } = await setup();
  const now = Date.now();
  await t.run((ctx) =>
    ctx.db.insert("exportJobs", {
      userId: OWNER,
      status: "ready",
      cancelRequested: false,
      quotaCountedAt: now,
      createdAt: now,
      updatedAt: now,
    })
  );
  const refused = await request("POST", "/v1/exports");
  expect(refused.status).toBe(429);
  expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
  const body = await refused.json();
  expect(body.code).toBe("RATE_LIMITED");
  expect(body.retryAt).toBeGreaterThan(now);

  const latest = await (await request("GET", "/v1/exports/latest")).json();
  expect(latest.canStartNew).toBe(false);
  expect(latest.nextAvailableAt).toBeGreaterThan(now);
  expect(latest.job).toMatchObject({ status: "ready", downloadUrl: null });
});
