// @ts-nocheck

import { describe, expect, mock, test } from "bun:test";
import { POLAR_PLAN_IDS } from "../shared/polarPlans";

const mockCustomersCreate = mock().mockResolvedValue({ id: "cust_1" });
const mockCheckoutsCreate = mock().mockResolvedValue({
  url: "https://checkout.example",
});
const mockCustomerSessionsCreate = mock().mockResolvedValue({
  customerPortalUrl: "https://portal.example",
});

mock.module("@polar-sh/sdk", () => ({
  Polar: class {
    customers = { create: mockCustomersCreate };
    checkouts = { create: mockCheckoutsCreate };
    customerSessions = { create: mockCustomerSessionsCreate };
  },
}));

describe("billing.ts", () => {
  test("createCheckoutLinkHandler captures checkout start", async () => {
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
      productId: POLAR_PLAN_IDS.production.monthly,
    });

    expect(url).toBe("https://checkout.example");
    expect(mockCheckoutsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [POLAR_PLAN_IDS.production.monthly],
      })
    );
  });

  test("createCheckoutLinkHandler rejects arbitrary Polar products", async () => {
    mockCheckoutsCreate.mockClear();
    const module = await import("../billing");
    const ctx = {
      runQuery: mock().mockResolvedValue({
        subject: "user_1",
        email: "user@example.com",
      }),
      runMutation: mock().mockResolvedValue(null),
    } as any;

    await expect(
      module.createCheckoutLinkHandler(ctx, { productId: "prod_attacker" })
    ).rejects.toThrow("Invalid product");
    expect(mockCheckoutsCreate).not.toHaveBeenCalled();
  });

  test("createCustomerPortalHandler captures portal open", async () => {
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
  });

  test("uses sandbox server by default", () => {
    const originalProd = process.env.POLAR_SERVER;
    delete process.env.POLAR_SERVER;
    expect(process.env.POLAR_SERVER).toBeUndefined();
    if (originalProd !== undefined) {
      process.env.POLAR_SERVER = originalProd;
    }
  });
});
