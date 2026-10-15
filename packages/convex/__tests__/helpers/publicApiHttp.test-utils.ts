/**
 * Shared harness for the public API HTTP tests: R2 env fixtures plus the
 * authorized-mutation mock builders every split test file uses.
 */
import { mock } from "bun:test";
import { withMappedOwner } from "./session.test-utils";

process.env.R2_BUCKET = "test-r2-bucket";

export const runHandler = (fn: any, ctx: any, request: Request) => {
  const handler = (fn as any).handler ?? fn;
  return handler(withMappedOwner(ctx), request);
};

// validateUserApiKey resolves the owner and charges the rate limit in one call.
export const buildAuthorizedMutationMock = () =>
  mock().mockResolvedValueOnce({
    keyId: "key_1",
    userId: "user_1",
    access: "full_access",
    source: "component",
    rateLimitKey: "component:key_1",
    rateLimit: { ok: true, retryAt: undefined },
  });

// Requests without an Idempotency-Key make no further auth-side calls.
export const buildAuthorizedMutationMockWithIdempotencySkip =
  buildAuthorizedMutationMock;
