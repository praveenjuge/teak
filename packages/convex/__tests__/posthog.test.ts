import { describe, expect, mock, test } from "bun:test";
import { components } from "../_generated/api";

const posthogConstructorCalls: Array<{
  component: unknown;
  options: {
    identify?: (ctx: unknown) => Promise<{ distinctId: string } | null>;
  };
}> = [];

class MockPostHog {
  constructor(
    public component: unknown,
    public options: {
      identify?: (ctx: unknown) => Promise<{ distinctId: string } | null>;
    }
  ) {
    posthogConstructorCalls.push({ component, options });
  }
}

mock.module("@posthog/convex", () => ({
  PostHog: MockPostHog,
}));

describe("posthog.ts", () => {
  test("configures PostHog with the Convex component and identify callback", async () => {
    const module = await import("../posthog");
    const [{ component, options }] = posthogConstructorCalls;

    expect(module.posthog).toBeInstanceOf(MockPostHog);
    expect(component).toEqual(components.posthog);

    const identify = options.identify;
    expect(typeof identify).toBe("function");

    await expect(
      identify?.({
        auth: {
          getUserIdentity: async () => ({ subject: "user_123" }),
        },
      })
    ).resolves.toEqual({ distinctId: "user_123" });

    await expect(
      identify?.({
        auth: {
          getUserIdentity: async () => null,
        },
      })
    ).resolves.toBeNull();

    await expect(identify?.({})).resolves.toBeNull();
  });
});
