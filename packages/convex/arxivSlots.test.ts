/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// The categorize step's arXiv API slots (categorization/mutations.ts): one
// request every 3 seconds across the deployment, at most 3 waiting.

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.useRealTimers();
});

test("hands out a slot now, then waits in turn, then refuses past the queue", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  const take = () =>
    t.mutation(internal.workflows.steps.categorization.mutations.takeArxivSlot);

  const first = await take();
  const queued = [await take(), await take(), await take()];
  const refused = await take();

  expect(first).toEqual({ retryAfter: 0 });
  // One request every 3 seconds: each waiting slot is 3 seconds after the last.
  expect(queued.map((slot) => slot?.retryAfter)).toEqual([3000, 6000, 9000]);
  expect(refused).toBeNull();

  // Once the waits pass, a slot is free again.
  vi.advanceTimersByTime(60_000);
  expect(await take()).toEqual({ retryAfter: 0 });
});
