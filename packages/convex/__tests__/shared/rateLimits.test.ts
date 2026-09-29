import { describe, expect, test } from "bun:test";
import { rateLimiter } from "../../shared/rateLimits";

describe("shared/rateLimits", () => {
  test("shards the high-volume limits to avoid write contention", () => {
    expect(rateLimiter.limits?.cardCreation.shards).toBe(6);
    expect(rateLimiter.limits?.raycastApiRequests.shards).toBe(12);
    expect(rateLimiter.limits?.invalidApiAuth.shards).toBe(6);
    expect(rateLimiter.limits?.nativeAuthPoll.shards).toBe(2);
    expect(rateLimiter.limits?.apiKeyCreation).not.toHaveProperty("shards");
  });
});
