import { describe, expect, test } from "bun:test";
import {
  getPolarPlanIds,
  isApprovedActiveSubscription,
  isApprovedPolarProductId,
  POLAR_PLAN_IDS,
} from "../../shared/polarPlans";

describe("polarPlans", () => {
  test("checkout accepts every plan it offers, in both environments, and nothing else", () => {
    for (const environment of ["development", "production"] as const) {
      const { monthly, yearly } = getPolarPlanIds(environment);
      expect(isApprovedPolarProductId(monthly)).toBe(true);
      expect(isApprovedPolarProductId(yearly)).toBe(true);
    }
    expect(isApprovedPolarProductId("prod_attacker")).toBe(false);
    expect(isApprovedPolarProductId(undefined)).toBe(false);
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
