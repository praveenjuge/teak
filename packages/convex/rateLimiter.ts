import { RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { isRateLimitContentionError } from "./convexFailures";
import { RATE_LIMIT_CONFIG } from "./shared/rateLimits";

// The limits are pure data in shared/ (the Core Worker and end-to-end tests
// read them); the limiter that enforces them needs the Convex component.
export const rateLimiter = new RateLimiter(
  components.rateLimiterV2,
  RATE_LIMIT_CONFIG
);

export const rateLimitResultValidator = v.object({
  ok: v.boolean(),
  retryAt: v.optional(v.number()),
});

export interface RateLimitResult {
  ok: boolean;
  retryAt?: number;
}

const INVALID_API_AUTH_BUCKET_KEY = "public-api-invalid-auth";

/** The `publicApiRequests` key of a WorkOS Connect client acting for a user. */
export const workosRateLimitKey = (clientId: string, teakUserId: string) =>
  `workos:${clientId}:${teakUserId}`;

// Contention on a limit's shards refuses the request for a second instead of
// failing it.
const takeOne = async (
  ctx: MutationCtx,
  name: "invalidApiAuth" | "publicApiRequests",
  key: string
): Promise<RateLimitResult> => {
  try {
    const result = await rateLimiter.limit(ctx, name, { key, throws: false });
    return {
      ok: result.ok,
      retryAt:
        typeof result.retryAfter === "number"
          ? Date.now() + result.retryAfter
          : undefined,
    };
  } catch (error) {
    if (isRateLimitContentionError(error)) {
      return { ok: false, retryAt: Date.now() + 1000 };
    }
    throw error;
  }
};

/**
 * Charges one public API request to a validated caller's limit, named by its
 * `rateLimitKey` (an API key's, or `workosRateLimitKey`).
 */
export const limitApiRequests = (
  ctx: MutationCtx,
  rateLimitKey: string
): Promise<RateLimitResult> =>
  takeOne(ctx, "publicApiRequests", `key:${rateLimitKey}`);

/** Charges one request with a credential that didn't check out. */
export const limitInvalidApiAuth = (
  ctx: MutationCtx
): Promise<RateLimitResult> =>
  takeOne(ctx, "invalidApiAuth", INVALID_API_AUTH_BUCKET_KEY);
