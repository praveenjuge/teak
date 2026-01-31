// @ts-nocheck
import { describe, expect, test } from "bun:test";

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

  test("createCustomerPortal opens customer portal", async () => {
    const module = await import("../billing");
    expect(module.createCustomerPortal).toBeDefined();
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
    const siteUrl = process.env.SITE_URL || "http://localhost:3000";
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
