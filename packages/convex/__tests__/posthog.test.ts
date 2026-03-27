import { beforeEach, describe, expect, mock, test } from "bun:test";
import { components } from "../_generated/api";

const posthogConstructorCalls: Array<{
  component: unknown;
  options: {
    identify?: (ctx: unknown) => Promise<{ distinctId: string } | null>;
  };
}> = [];

const posthogCaptureCalls: Array<{
  ctx: unknown;
  payload: {
    event: string;
    distinctId?: string;
    properties?: Record<string, unknown>;
  };
}> = [];

class MockPostHog {
  component: unknown;
  options: {
    identify?: (ctx: unknown) => Promise<{ distinctId: string } | null>;
  };

  constructor(
    component: unknown,
    options: {
      identify?: (ctx: unknown) => Promise<{ distinctId: string } | null>;
    }
  ) {
    this.component = component;
    this.options = options;
    posthogConstructorCalls.push({ component, options });
  }

  async capture(
    ctx: unknown,
    payload: {
      event: string;
      distinctId?: string;
      properties?: Record<string, unknown>;
    }
  ) {
    posthogCaptureCalls.push({ ctx, payload });
  }
}

mock.module("@posthog/convex", () => ({
  PostHog: MockPostHog,
}));

describe("posthog.ts", () => {
  beforeEach(() => {
    posthogCaptureCalls.length = 0;
  });

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

  test("captures backend events with merged Teak super properties", async () => {
    const module = await import("../posthog");
    const ctx = { scheduler: {} };

    await module.captureBackendEvent(ctx, {
      event: "backend_card_created",
      distinctId: "user_123",
      properties: {
        cardType: "link",
      },
    });

    expect(posthogCaptureCalls).toHaveLength(1);
    expect(posthogCaptureCalls[0]).toMatchObject({
      ctx,
      payload: {
        event: "backend_card_created",
        distinctId: "user_123",
        properties: {
          analytics_source: "convex_backend",
          cardType: "link",
          teak_environment: "development",
          teak_source: "convex",
          teak_version: "1.0.25",
        },
      },
    });
  });
});
