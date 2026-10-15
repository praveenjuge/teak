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
    // Six shards retain five burst tokens per shard while covering the
    // observed eight-request production concurrency without exhausting
    // Convex's OCC retry budget. When changing an existing deployment from
    // three shards, first observe one full period without card-creation
    // traffic so the old shards are full before the new shards become live.
    shards: 6,
  },
  // Card edits reserve reprocess tokens instead of being refused (see
  // `reserveEditReprocess`), so `maxReserved` bounds how far ahead they queue.
  cardReprocess: {
    kind: "token bucket",
    rate: 6,
    period: MINUTE,
    capacity: 6,
    maxReserved: 6,
  },
  // One reserved token per card: while an edit's deferred run is waiting,
  // later edits join it instead of queueing another.
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
  // Vector searches a user's searches start, counted only when the meaning
  // matches are not cached; past it, search is keyword-only for a while.
  semanticSearch: {
    kind: "token bucket",
    rate: 60,
    period: MINUTE,
    capacity: 60,
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
