import { RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { RATE_LIMIT_CONFIG } from "./shared/rateLimits";

// The limits are pure data in shared/ (the Core Worker and end-to-end tests
// read them); the limiter that enforces them needs the Convex component.
export const rateLimiter = new RateLimiter(
  components.rateLimiterV2,
  RATE_LIMIT_CONFIG
);
