// @ts-nocheck
import { describe, expect, test, mock } from "bun:test";

mock.module("@convex-dev/workflow/convex.config", () => ({
  default: { componentDefinitionPath: "workflow" },
}));
mock.module("@convex-dev/polar/convex.config", () => ({
  default: { componentDefinitionPath: "polar" },
}));
mock.module("@convex-dev/migrations/convex.config", () => ({
  default: { componentDefinitionPath: "migrations" },
}));
mock.module("@convex-dev/better-auth/convex.config", () => ({
  default: { componentDefinitionPath: "better-auth" },
}));
mock.module("@convex-dev/resend/convex.config", () => ({
  default: { componentDefinitionPath: "resend" },
}));
mock.module("@convex-dev/ratelimiter/convex.config", () => ({
  default: { componentDefinitionPath: "ratelimiter" },
}));

describe("convex.config.ts", () => {
  test("module exports", async () => {
    const module = await import("../convex.config");
    expect(module).toBeTruthy();
  });
});
