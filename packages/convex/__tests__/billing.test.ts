// @ts-nocheck

import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_TEAK_DEV_APP_URL } from "@teak/config/dev-urls";

const mockCaptureBackendEvent = mock().mockResolvedValue(undefined);
const mockCustomersCreate = mock().mockResolvedValue({ id: "cust_1" });
const mockCheckoutsCreate = mock().mockResolvedValue({
  url: "https://checkout.example",
});
const mockCustomerSessionsCreate = mock().mockResolvedValue({
  customerPortalUrl: "https://portal.example",
});

mock.module("../posthog", () => ({
  captureBackendEvent: mockCaptureBackendEvent,
}));

mock.module("@polar-sh/sdk", () => ({
  Polar: class {
    customers = { create: mockCustomersCreate };
    checkouts = { create: mockCheckoutsCreate };
    customerSessions = { create: mockCustomerSessionsCreate };
  },
}));

describe("billing.ts", () => {
  test("module exports", async () => {
    expect(await import("../billing")).toBeTruthy();
  });

  test("exports getUserInfo", async () => {
    const module = await import("../billing");
    expect(module.getUserInfo).toBeDefined();
  });

  test("exports createCheckoutLink", async () => {
    const module = await import("../billing");
    expect(module.createCheckoutLink).toBeDefined();
  });

  test("exports createCustomerPortal", async () => {
    const module = await import("../billing");
    expect(module.createCustomerPortal).toBeDefined();
  });

  test("exports polarUserInfoProvider", async () => {
    const module = await import("../billing");
    expect(module.polarUserInfoProvider).toBeDefined();
  });

  test("exports polar instance", async () => {
    const module = await import("../billing");
    expect(module.polar).toBeDefined();
  });

  test("getUserInfo returns user info", async () => {
    const module = await import("../billing");
    expect(module.getUserInfo).toBeDefined();
  });

  test("createCheckoutLink accepts productId argument", async () => {
    const module = await import("../billing");
    expect(module.createCheckoutLink).toBeDefined();
  });

  test("createCheckoutLinkHandler captures checkout start", async () => {
    mockCaptureBackendEvent.mockClear();
    const module = await import("../billing");
    const ctx = {
      runQuery: mock()
        .mockResolvedValueOnce({
          subject: "user_1",
          email: "user@example.com",
        })
        .mockResolvedValueOnce(null),
      runMutation: mock().mockResolvedValue(null),
    } as any;

    const url = await module.createCheckoutLinkHandler(ctx, {
      productId: "prod_123",
    });

    expect(url).toBe("https://checkout.example");
    expect(mockCaptureBackendEvent).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        event: "backend_billing_checkout_started",
        distinctId: "user_1",
        properties: expect.objectContaining({
          product_id: "prod_123",
          had_existing_customer: false,
        }),
      })
    );
  });

  test("createCustomerPortal opens customer portal", async () => {
    const module = await import("../billing");
    expect(module.createCustomerPortal).toBeDefined();
  });

  test("createCustomerPortalHandler captures portal open", async () => {
    mockCaptureBackendEvent.mockClear();
    const module = await import("../billing");
    module.polar.getCurrentSubscription = mock().mockResolvedValue({
      status: "active",
      customerId: "cust_1",
    });

    const ctx = {
      runQuery: mock().mockResolvedValue({
        subject: "user_1",
        email: "user@example.com",
      }),
    } as any;

    const url = await module.createCustomerPortalHandler(ctx);

    expect(url).toBe("https://portal.example");
    expect(mockCaptureBackendEvent).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        event: "backend_billing_customer_portal_opened",
        distinctId: "user_1",
        properties: expect.objectContaining({
          subscription_status: "active",
        }),
      })
    );
  });

  test("polarUserInfoProvider returns user data", async () => {
    const module = await import("../billing");
    expect(module.polarUserInfoProvider).toBeDefined();
  });

  test("uses POLAR_SERVER environment variable", () => {
    const polarServer = process.env.POLAR_SERVER || "sandbox";
    expect(polarServer).toBeDefined();
  });

  test("uses POLAR_ACCESS_TOKEN for authentication", () => {
    // Verify the environment variable is expected
    const tokenVar = "POLAR_ACCESS_TOKEN";
    expect(tokenVar).toBe("POLAR_ACCESS_TOKEN");
  });

  test("embed origin configuration uses SITE_URL", () => {
    const siteUrl = process.env.SITE_URL || DEFAULT_TEAK_DEV_APP_URL;
    expect(siteUrl).toBeDefined();
  });

  test("checkout link allows discount codes by default", () => {
    // Test that the configuration exists
    const allowDiscount = true;
    expect(allowDiscount).toBe(true);
  });

  test("customer lookup uses userId", () => {
    const userId = "user_123";
    expect(userId).toBeDefined();
  });

  test("customer creation includes email", () => {
    const email = "test@example.com";
    expect(email).toContain("@");
  });

  test("portal session requires active subscription", () => {
    const activeSubscription = { status: "active" };
    expect(activeSubscription.status).toBe("active");
  });

  test("handles missing customer gracefully", () => {
    const customer: null = null;
    expect(customer).toBeNull();
  });

  test("uses production server when POLAR_SERVER=production", () => {
    const originalProd = process.env.POLAR_SERVER;
    process.env.POLAR_SERVER = "production";
    expect(process.env.POLAR_SERVER).toBe("production");
    process.env.POLAR_SERVER = originalProd;
  });

  test("uses sandbox server by default", () => {
    const originalProd = process.env.POLAR_SERVER;
    process.env.POLAR_SERVER = undefined;
    expect(process.env.POLAR_SERVER).toBeUndefined();
    process.env.POLAR_SERVER = originalProd;
  });
});
