import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
const { fetchSessionToken } = await import("@/lib/session-token");

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

// AuthKit refreshes through a Server Action, whose fetch rejects with a
// TypeError when the request never gets a response. When the server answers
// but the refresh fails, AuthKit throws a plain Error.
const offline = () => new TypeError("Failed to fetch");
const refused = () => new Error("Failed to refresh access token");

const failingOnce = (error: () => Error, afterFailure?: () => void) => {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls === 1) {
      afterFailure?.();
      return Promise.reject(error());
    }
    return Promise.resolve("fresh-token");
  };
};

// Skips the wait before the next attempt.
const backOnline = () =>
  setTimeout(() => window.dispatchEvent(new Event("online")), 0);

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`still waiting after ${ms}ms`)), ms)
    ),
  ]);

test("retries as soon as the browser is back online", async () => {
  const load = failingOnce(offline, backOnline);

  expect(await within(fetchSessionToken(load), 500)).toBe("fresh-token");
});

test("keeps retrying when the browser never reports the connection dropping", async () => {
  // A laptop waking up fails DNS lookups while navigator.onLine stays true.
  expect(await fetchSessionToken(failingOnce(offline))).toBe("fresh-token");
});

test("rides out a refresh the server fails once", async () => {
  const load = failingOnce(refused, backOnline);

  expect(await within(fetchSessionToken(load), 500)).toBe("fresh-token");
});

test("reports the session gone when the server keeps refusing the refresh", async () => {
  const load = () => {
    backOnline();
    return Promise.reject(refused());
  };

  expect(await within(fetchSessionToken(load), 500)).toBeNull();
});
