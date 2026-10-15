import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

export const RATE_LIMIT_CONFIG = {
  cardCreation: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 30,
    // Six shards retain five burst tokens per shard while covering the
    // observed eight-request production concurrency without exhausting
    // Convex's OCC retry budget.
    shards: 6,
  },
  cardReprocess: {
    kind: "token bucket",
    rate: 6,
    period: MINUTE,
    capacity: 6,
    maxReserved: 6,
  },
  cardReprocessPerCard: {
    kind: "token bucket",
    rate: 1,
    period: MINUTE,
    capacity: 1,
    maxReserved: 1,
  },
  publicApiRequests: {
    kind: "token bucket",
    rate: 120,
    period: MINUTE,
    capacity: 120,
    shards: 12,
  },
  invalidApiAuth: {
    kind: "token bucket",
    rate: 60,
    period: MINUTE,
    capacity: 60,
    shards: 6,
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
