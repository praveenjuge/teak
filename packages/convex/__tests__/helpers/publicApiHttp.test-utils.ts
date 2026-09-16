// @ts-nocheck
/**
 * Shared harness for the public API HTTP tests: R2 env fixtures plus the
 * authorized-mutation mock builders every split test file uses.
 */
import { mock } from "bun:test";

process.env.R2_ACCESS_KEY_ID = "test-r2-access-key";
process.env.R2_BUCKET = "test-r2-bucket";
process.env.R2_ENDPOINT = "https://test-account.r2.cloudflarestorage.com";
process.env.R2_SECRET_ACCESS_KEY = "test-r2-secret";

export const runHandler = (fn: any, ctx: any, request: Request) => {
  const handler = (fn as any).handler ?? fn;
  return handler(ctx, request);
};

export const buildAuthorizedMutationMock = () =>
  mock()
    // validateUserApiKey now runs first (effectively read-only on hot path)...
    .mockResolvedValueOnce({
      keyId: "key_1",
      userId: "user_1",
      access: "full_access",
      source: "component",
      rateLimitKey: "component:key_1",
    })
    // ...then the per-key rate limit check.
    .mockResolvedValueOnce({ ok: true, retryAt: undefined });

export const buildAuthorizedMutationMockWithIdempotencySkip = () =>
  buildAuthorizedMutationMock().mockResolvedValueOnce(undefined);
