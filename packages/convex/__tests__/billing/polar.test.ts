import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  polarCustomerOwnerId,
  readCardEntitlement,
  readHasPremium,
} from "../../billing/polar";
import { POLAR_PLAN_IDS } from "../../shared/polarPlans";

const ctx = { runQuery: mock() } as never;
const originalBillingDisabled = process.env.BILLING_DISABLED;

afterEach(() => {
  if (originalBillingDisabled === undefined) {
    delete process.env.BILLING_DISABLED;
  } else {
    process.env.BILLING_DISABLED = originalBillingDisabled;
  }
});

const activePro = () =>
  Promise.resolve({
    productId: POLAR_PLAN_IDS.production.monthly,
    status: "active",
  });

describe("readHasPremium", () => {
  test("an active subscription to an approved plan is Pro", async () => {
    expect(await readHasPremium(ctx, "user_1", activePro)).toBe(true);
  });

  test("a lookup that fails keeps the free limits and says so", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      await readHasPremium(ctx, "user_1", () =>
        Promise.reject(new Error("component unavailable"))
      )
    ).toBe(false);
    expect(logged).toHaveBeenCalledWith(
      "[billing] subscription lookup failed; applying free limits",
      { error: "component unavailable" }
    );
    logged.mockRestore();
  });
});

describe("readCardEntitlement", () => {
  test("everyone has Pro limits while billing is off", async () => {
    process.env.BILLING_DISABLED = "true";
    expect(
      await readCardEntitlement(ctx, "user_1", () => Promise.resolve(null))
    ).toBe(true);
  });

  test("otherwise follows the subscription", async () => {
    delete process.env.BILLING_DISABLED;
    expect(
      await readCardEntitlement(ctx, "user_1", () => Promise.resolve(null))
    ).toBe(false);
    expect(await readCardEntitlement(ctx, "user_1", activePro)).toBe(true);
  });
});

describe("polarCustomerOwnerId", () => {
  test("prefers the user ID Teak wrote into the customer's metadata", () => {
    expect(
      polarCustomerOwnerId({
        externalId: "external",
        metadata: { userId: "teak_user" },
      })
    ).toBe("teak_user");
  });

  test("falls back to the customer's external ID", () => {
    expect(polarCustomerOwnerId({ externalId: "external", metadata: {} })).toBe(
      "external"
    );
    expect(polarCustomerOwnerId({ metadata: {} })).toBeUndefined();
  });
});
