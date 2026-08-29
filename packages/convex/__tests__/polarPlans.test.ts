import { describe, expect, test } from "bun:test";
import {
  APPROVED_POLAR_PRODUCT_IDS,
  getPolarPlanIds,
  isApprovedActiveSubscription,
  isApprovedPolarProductId,
  POLAR_PLAN_IDS,
} from "../shared/polarPlans";

describe("polarPlans", () => {
  test("checkout allowlist includes monthly and yearly products", () => {
    expect(POLAR_PLAN_IDS.production).toEqual({
      monthly: "d46c71a7-61dc-4dc8-b53d-9a73d0204c28",
      yearly: "6fb24b68-09e0-42c4-b090-f0e03cb7de56",
    });
    expect(APPROVED_POLAR_PRODUCT_IDS.size).toBe(4);
    expect(isApprovedPolarProductId(POLAR_PLAN_IDS.production.monthly)).toBe(
      true
    );
    expect(isApprovedPolarProductId("prod_attacker")).toBe(false);
  });

  test("premium requires an active approved product", () => {
    expect(
      isApprovedActiveSubscription({
        productId: POLAR_PLAN_IDS.production.yearly,
        status: "active",
      })
    ).toBe(true);
    expect(
      isApprovedActiveSubscription({
        productId: "prod_attacker",
        status: "active",
      })
    ).toBe(false);
    expect(
      isApprovedActiveSubscription({
        productId: POLAR_PLAN_IDS.production.monthly,
        status: "canceled",
      })
    ).toBe(false);
  });
});
