// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";

mock.module("@convex-dev/workflow/convex.config", () => ({
  default: { componentDefinitionPath: "workflow" },
}));
mock.module("@convex-dev/polar/convex.config", () => ({
  default: { componentDefinitionPath: "polar" },
}));
mock.module("@convex-dev/migrations/convex.config", () => ({
  default: { componentDefinitionPath: "migrations" },
}));
mock.module("@convex-dev/resend/convex.config", () => ({
  default: { componentDefinitionPath: "resend" },
}));
mock.module("@convex-dev/ratelimiter/convex.config", () => ({
  default: { componentDefinitionPath: "ratelimiter" },
}));
mock.module("@posthog/convex/convex.config", () => ({
  default: { componentDefinitionPath: "posthog" },
}));

describe("convex.config.ts", () => {
  test("module exports", async () => {
    const module = await import("../convex.config");
    expect(module).toBeTruthy();
  });
});
