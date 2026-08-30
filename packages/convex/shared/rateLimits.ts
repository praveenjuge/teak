import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

/**
 * Rate limiter configuration for card creation.
 *
 * Uses token bucket algorithm: 30 cards per minute for all users.
 */
export const RATE_LIMIT_CONFIG = {
  cardCreation: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 30,
    shards: 3,
  },
  cardReprocess: {
    kind: "token bucket",
    rate: 6,
    period: MINUTE,
    capacity: 6,
  },
  cardReprocessPerCard: {
    kind: "token bucket",
    rate: 1,
    period: MINUTE,
    capacity: 1,
  },
  raycastApiRequests: {
    kind: "token bucket",
    rate: 120,
    period: MINUTE,
    capacity: 120,
    shards: 12,
  },
  // Shared bucket for invalid / unauthenticated public-API auth attempts.
  // All failures are consolidated onto a single keyed document so attackers
  // cannot spray fresh per-token buckets by rotating bearer tokens.
  invalidApiAuth: {
    kind: "token bucket",
    rate: 60,
    period: MINUTE,
    capacity: 60,
    shards: 6,
  },
  // Desktop OAuth -> session exchange. Keyed per client IP so a single host
  // cannot spam single-use token redemption attempts.
  desktopOauthExchange: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 10,
  },
  // Native auth device-poll endpoint. Keyed per client IP so a single host
  // cannot spam single-use code redemption attempts while a device polls.
  nativeAuthPoll: {
    kind: "token bucket",
    rate: 20,
    period: MINUTE,
    capacity: 20,
    shards: 2,
  },
  apiKeyCreation: {
    kind: "token bucket",
    rate: 5,
    period: MINUTE,
    capacity: 5,
  },
} as const;

export const rateLimiter = new RateLimiter(
  components.rateLimiterV2,
  RATE_LIMIT_CONFIG
);
