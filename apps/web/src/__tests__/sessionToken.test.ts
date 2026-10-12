import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
const { fetchSessionToken } = await import("@/lib/session-token");

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

// AuthKit refreshes through a Server Action, whose fetch rejects with a
// TypeError when the request never gets a response.
const failingOnce = (afterFailure?: () => void) => {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls === 1) {
      afterFailure?.();
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    return Promise.resolve("fresh-token");
  };
};

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`still waiting after ${ms}ms`)), ms)
    ),
  ]);

test("retries as soon as the browser is back online", async () => {
  const load = failingOnce(() =>
    setTimeout(() => window.dispatchEvent(new Event("online")), 0)
  );

  expect(await within(fetchSessionToken(load), 500)).toBe("fresh-token");
});

test("keeps retrying when the browser never reports the connection dropping", async () => {
  // A laptop waking up fails DNS lookups while navigator.onLine stays true.
  expect(await fetchSessionToken(failingOnce())).toBe("fresh-token");
});

test("reports the session gone when the server refuses the refresh", async () => {
  const token = await fetchSessionToken(() =>
    Promise.reject(new Error("Failed to refresh access token"))
  );

  expect(token).toBeNull();
});
