import { describe, expect, mock, test } from "bun:test";
import {
  limitApiRequests,
  limitInvalidApiAuth,
  workosRateLimitKey,
} from "../rateLimiter";
import { mockMutationCtx } from "./helpers/convex.test-utils";

const CONTENTION = new Error(
  'Documents read from or written to the "rateLimits" table changed while this mutation was being run and on every subsequent retry.'
);

// The rate limiter component is called through runMutation; its bucket key
// is the second argument. Stored buckets are keyed by these exact strings.
const limitedKey = (runMutation: ReturnType<typeof mock>) =>
  runMutation.mock.calls[0]?.[1] as { key: string; name: string };

describe("public API rate limits", () => {
  test("an API key's requests are charged to key:<its rate limit key>", async () => {
    const runMutation = mock().mockResolvedValue({ ok: true });

    const result = await limitApiRequests(
      mockMutationCtx({ runMutation }),
      "component:key_42"
    );

    expect(result.ok).toBe(true);
    expect(limitedKey(runMutation)).toMatchObject({
      key: "key:component:key_42",
      name: "publicApiRequests",
    });
  });

  test("a WorkOS Connect client's requests are charged per client and user", async () => {
    const runMutation = mock().mockResolvedValue({ ok: true });

    await limitApiRequests(
      mockMutationCtx({ runMutation }),
      workosRateLimitKey("client_01", "user_1")
    );

    expect(limitedKey(runMutation).key).toBe("key:workos:client_01:user_1");
  });

  test("bad credentials share one bucket", async () => {
    const runMutation = mock().mockResolvedValue({ ok: true });

    await limitInvalidApiAuth(mockMutationCtx({ runMutation }));

    expect(limitedKey(runMutation)).toMatchObject({
      key: "public-api-invalid-auth",
      name: "invalidApiAuth",
    });
  });

  test.each([
    ["a caller's limit", "publicApiRequests"],
    ["the bad-credential limit", "invalidApiAuth"],
  ])(
    "contention on %s refuses the request for a second",
    async (_name, bucket) => {
      const now = Date.now();
      const ctx = mockMutationCtx({
        runMutation: mock().mockRejectedValue(CONTENTION),
      });

      const result =
        bucket === "invalidApiAuth"
          ? await limitInvalidApiAuth(ctx)
          : await limitApiRequests(ctx, "component:k");

      expect(result.ok).toBe(false);
      expect(result.retryAt).toBeGreaterThanOrEqual(now + 1000);
    }
  );

  test("any other limiter failure is not swallowed", async () => {
    const ctx = mockMutationCtx({
      runMutation: mock().mockRejectedValue(new Error("boom")),
    });

    await expect(limitApiRequests(ctx, "component:k")).rejects.toThrow("boom");
  });
});
