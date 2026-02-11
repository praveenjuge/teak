import { MINUTE, RateLimiter } from "@convex-dev/ratelimiter";
import { components } from "../_generated/api";

/**
 * Rate limiter configuration for card creation.
 *
 * Uses token bucket algorithm: 30 cards per minute for all users.
 */
export const rateLimiter = new RateLimiter(components.ratelimiter, {
  cardCreation: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 30,
  },
  raycastApiRequests: {
    kind: "token bucket",
    rate: 120,
    period: MINUTE,
    capacity: 120,
  },
});
