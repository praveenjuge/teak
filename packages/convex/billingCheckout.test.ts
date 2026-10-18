import polarTest from "@convex-dev/polar/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  seedWorkosOwner,
  updateComponentUser,
} from "./__tests__/helpers/workosOwner.test-utils";
import { api, components } from "./_generated/api";
import schema from "./schema";
import { POLAR_PLAN_IDS } from "./shared/polarPlans";

const polarSdk = vi.hoisted(() => {
  const undeliverable = /(^|\.)(example\.(com|net|org)|test)$/;
  return {
    customersCreate: vi.fn(
      (body: { email: string; metadata: Record<string, string> }) => {
        const domain = body.email.split("@").pop() ?? "";
        if (undeliverable.test(domain)) {
          return Promise.reject(
            new Error(
              `${body.email} is not a valid email address: The domain name ${domain} does not accept email.`
            )
          );
        }
        return Promise.resolve({ id: "cust_sandbox", ...body });
      }
    ),
    checkoutsCreate: vi.fn(() =>
      Promise.resolve({ url: "https://sandbox.polar.sh/checkout/session" })
    ),
  };
});

vi.mock("@polar-sh/sdk", () => ({
  Polar: class {
    customers = { create: polarSdk.customersCreate };
    checkouts = { create: polarSdk.checkoutsCreate };
  },
}));

const modules = import.meta.glob("./**/*.ts");
const OWNER = "teak_devowner";

async function setup(email: string) {
  const t = convexTest(schema, modules);
  polarTest.register(t);
  workosTest.register(t);
  const workosUserId = await seedWorkosOwner(t, OWNER);
  await updateComponentUser(t, workosUserId, { email });
  const client = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_checkout",
    email_verified: true,
    external_id: OWNER,
  });
  return { t, client };
}

const checkout = (client: Awaited<ReturnType<typeof setup>>["client"]) =>
  client.action(api.billing.createCheckoutLink, {
    productId: POLAR_PLAN_IDS.development.monthly,
  });

const syncSubscription = (
  t: Awaited<ReturnType<typeof setup>>["t"],
  customerId: string
) =>
  t.run(async (ctx) => {
    const productId = POLAR_PLAN_IDS.development.monthly;
    const now = "2026-10-12T00:00:00.000Z";
    await ctx.runMutation(components.polar.lib.createProduct, {
      product: {
        id: productId,
        createdAt: now,
        modifiedAt: null,
        name: "Teak Pro",
        description: null,
        recurringInterval: "month",
        isRecurring: true,
        isArchived: false,
        organizationId: "org_sandbox",
        prices: [],
        medias: [],
      },
    });
    await ctx.runMutation(components.polar.lib.createSubscription, {
      subscription: {
        id: "sub_sandbox",
        customerId,
        createdAt: now,
        modifiedAt: null,
        amount: 500,
        currency: "usd",
        recurringInterval: "month",
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        startedAt: now,
        endedAt: null,
        productId,
        checkoutId: null,
        metadata: {},
      },
    });
  });

beforeEach(() => {
  polarSdk.customersCreate.mockClear();
  polarSdk.checkoutsCreate.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkout on the shared dev deployment", () => {
  test("gives a seeded example.org account a deliverable Polar customer and syncs its subscription", async () => {
    vi.stubEnv("TEAK_DEV_DEPLOYMENT", "true");
    const { t, client } = await setup("dev+vm-main@example.org");

    await expect(checkout(client)).resolves.toBe(
      "https://sandbox.polar.sh/checkout/session"
    );
    const customer = await polarSdk.customersCreate.mock.results[0]?.value;
    expect(customer).toEqual({
      id: "cust_sandbox",
      email: `teak-dev+${OWNER}@teakvault.com`,
      metadata: { userId: OWNER, email: "dev+vm-main@example.org" },
    });
    expect(polarSdk.checkoutsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cust_sandbox" })
    );

    expect(await client.query(api.auth.getCurrentUser, {})).toMatchObject({
      email: "dev+vm-main@example.org",
      hasPremium: false,
    });
    await syncSubscription(t, "cust_sandbox");
    expect(await client.query(api.auth.getCurrentUser, {})).toMatchObject({
      email: "dev+vm-main@example.org",
      hasPremium: true,
    });
  });

  test("keeps a deliverable address as the Polar customer email", async () => {
    vi.stubEnv("TEAK_DEV_DEPLOYMENT", "true");
    const { client } = await setup("owner@teakvault.com");

    await checkout(client);
    expect(polarSdk.customersCreate).toHaveBeenCalledWith({
      email: "owner@teakvault.com",
      metadata: { userId: OWNER },
    });
  });
});

test("outside the dev deployment, checkout sends the account's own email to Polar", async () => {
  const { client } = await setup("dev+vm-main@example.org");

  await expect(checkout(client)).rejects.toThrow("does not accept email");
  expect(polarSdk.customersCreate).toHaveBeenCalledWith({
    email: "dev+vm-main@example.org",
    metadata: { userId: OWNER },
  });
  expect(polarSdk.checkoutsCreate).not.toHaveBeenCalled();
});
