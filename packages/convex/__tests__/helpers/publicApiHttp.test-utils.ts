import { mock } from "bun:test";
import { withMappedOwner } from "./session.test-utils";

export const runHandler = (fn: any, ctx: any, request: Request) => {
  const handler = (fn as any).handler ?? fn;
  return handler(withMappedOwner(ctx), request);
};

export const buildAuthorizedMutationMock = () =>
  mock().mockResolvedValueOnce({
    keyId: "key_1",
    userId: "user_1",
    access: "full_access",
    source: "component",
    rateLimitKey: "component:key_1",
    rateLimit: { ok: true, retryAt: undefined },
  });

export const buildAuthorizedMutationMockWithIdempotencySkip =
  buildAuthorizedMutationMock;
