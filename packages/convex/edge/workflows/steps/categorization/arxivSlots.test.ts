/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "../../../../_generated/api";
import { newBackend } from "../../../helpers.testUtils";

afterEach(() => {
  vi.useRealTimers();
});

test("hands out a slot now, then waits in turn, then refuses past the queue", async () => {
  vi.useFakeTimers();
  const t = newBackend();
  const take = () =>
    t.mutation(internal.workflows.steps.categorization.mutations.takeArxivSlot);

  const first = await take();
  const queued = [await take(), await take(), await take()];
  const refused = await take();

  expect(first).toEqual({ retryAfter: 0 });
  expect(queued.map((slot) => slot?.retryAfter)).toEqual([3000, 6000, 9000]);
  expect(refused).toBeNull();

  vi.advanceTimersByTime(60_000);
  expect(await take()).toEqual({ retryAfter: 0 });
});
