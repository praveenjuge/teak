import { afterEach, describe, expect, test } from "bun:test";
import {
  mobileTracesSampler,
  resolveMobileEnvironment,
  resolveMobileRelease,
  resolvePseudonymousUserId,
  scrubMobilePayload,
} from "../../lib/sentry-config";

const originalEnvironment = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;

afterEach(() => {
  if (originalEnvironment === undefined) {
    delete process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
    return;
  }
  process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = originalEnvironment;
});

describe("mobile Sentry configuration", () => {
  test("uses canonical environments and binary release identity", () => {
    expect(resolveMobileEnvironment("prod", "production")).toBe("production");
    expect(resolveMobileRelease("1.0.56", "237")).toBe(
      "teak-mobile@1.0.56+237"
    );
    expect(resolveMobileRelease("1.0.56", undefined)).toBeUndefined();
  });

  test("retains important traces and samples routine production work", () => {
    process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = "production";
    expect(mobileTracesSampler({ name: "mobile.navigation" })).toBe(0.2);
    expect(mobileTracesSampler({ name: "mobile.card.save" })).toBe(1);
    expect(mobileTracesSampler({ name: "mobile.auth.bootstrap" })).toBe(1);
  });

  test("scrubs credentials and hashes authenticated users", async () => {
    expect(
      scrubMobilePayload({
        email: "person@example.com",
        token: "secret-value",
      })
    ).toEqual({ email: "[REDACTED_EMAIL]", token: "[REDACTED]" });

    const id = await resolvePseudonymousUserId("user-123");
    expect(id).toHaveLength(64);
    expect(id).not.toContain("user-123");
  });
});
