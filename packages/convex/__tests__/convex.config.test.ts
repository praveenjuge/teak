// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";

mock.module("@convex-dev/workflow/convex.config", () => ({
  default: { componentDefinitionPath: "workflow" },
}));
mock.module("@convex-dev/polar/convex.config", () => ({
  default: { componentDefinitionPath: "polar" },
}));
mock.module("@convex-dev/better-auth/convex.config", () => ({
  default: { componentDefinitionPath: "better-auth" },
}));
mock.module("@convex-dev/resend/convex.config", () => ({
  default: { componentDefinitionPath: "resend" },
}));
mock.module("@convex-dev/rate-limiter/convex.config", () => ({
  default: { componentDefinitionPath: "rateLimiterV2" },
}));
mock.module("@vllnt/convex-api-keys/convex.config", () => ({
  default: { componentDefinitionPath: "apiKeys" },
}));

describe("convex.config.ts", () => {
  test("module exports", async () => {
    const module = await import("../convex.config");
    expect(module).toBeTruthy();
  });
});
