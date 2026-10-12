import { Polar } from "@convex-dev/polar";
import { Polar as PolarBilling } from "@polar-sh/sdk";
import { ConvexError, v } from "convex/values";
import { api, components } from "./_generated/api";
import { action, env, query } from "./_generated/server";
import { readIsDevDeployment } from "./env";
import { getSessionProfile } from "./securitySessions";
import { isApprovedPolarProductId } from "./shared/polarPlans";
import { normalizeErrorClass } from "./shared/telemetry";
import { scheduleBillingOutcome } from "./telemetry/schedule";

// User query to use in the Polar component
export const getUserInfoHandler = async (ctx: any) => {
  const profile = await getSessionProfile(ctx);
  if (!profile) {
    throw new ConvexError("User not found");
  }
  return { teakUserId: profile.teakUserId, email: profile.user.email };
};

export const getUserInfo = query({
  args: {},
  handler: getUserInfoHandler,
});

export const polarUserInfoProvider = async (
  ctx: any
): Promise<{ userId: string; email: string; name?: string }> => {
  const user = await ctx.runQuery(api.billing.getUserInfo);
  if (!user?.email) {
    throw new ConvexError("User not found");
  }

  return {
    userId: user.teakUserId,
    email: user.email,
  };
};

export const polar = new Polar(components.polar, {
  getUserInfo: polarUserInfoProvider,
});

// Polar's sandbox refuses customer emails whose domain can't receive mail, and
// the shared dev deployment's seeded accounts sign in on reserved domains
// (dev+<machine>-<checkout>@example.org; WorkOS claims example.com for its
// test org). There the Polar customer gets an alias on Teak's own mail domain,
// with the real address kept in metadata. Polar customers map back to users by
// customer ID (the component's customers table), never by email, so
// subscription sync is unaffected. Production always uses the real address.
const DEV_POLAR_CUSTOMER_EMAIL_DOMAIN = "teakvault.com";
const RESERVED_EMAIL_DOMAIN =
  /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/;

const polarCustomerIdentity = (
  user: { teakUserId: string; email: string },
  isDevDeployment: boolean
): { email: string; metadata: Record<string, string> } => {
  const domain = user.email.split("@").pop()?.toLowerCase() ?? "";
  if (!(isDevDeployment && RESERVED_EMAIL_DOMAIN.test(domain))) {
    return { email: user.email, metadata: { userId: user.teakUserId } };
  }
  const alias = user.teakUserId.replace(/[^A-Za-z0-9_-]/g, "-");
  return {
    email: `teak-dev+${alias}@${DEV_POLAR_CUSTOMER_EMAIL_DOMAIN}`,
    metadata: { userId: user.teakUserId, email: user.email },
  };
};

export const createCheckoutLinkHandler = async (ctx: any, args: any) => {
  let userId: string | undefined;
  try {
    const user = await ctx.runQuery(api.billing.getUserInfo);
    userId = user.teakUserId;
    if (!isApprovedPolarProductId(args.productId)) {
      throw new ConvexError("Invalid product");
    }
    await scheduleBillingOutcome(ctx, {
      flow: "checkout",
      outcome: "attempt",
      userId,
    });

    const polar = new PolarBilling({
      accessToken: env.POLAR_ACCESS_TOKEN ?? "",
      server: env.POLAR_SERVER === "production" ? "production" : "sandbox",
    });

    const dbCustomer = await ctx.runQuery(
      components.polar.lib.getCustomerByUserId,
      {
        userId: user.teakUserId,
      }
    );
    const createCustomer = async () => {
      const customer = await polar.customers.create(
        polarCustomerIdentity(user, readIsDevDeployment())
      );
      if (!customer.id) {
        throw new Error("Customer not created");
      }
      return customer.id;
    };
    const customerId = dbCustomer?.id || (await createCustomer());

    if (!dbCustomer) {
      await ctx.runMutation(components.polar.lib.insertCustomer, {
        id: customerId,
        userId: user.teakUserId,
      });
    }

    const checkout = await polar.checkouts.create({
      products: [args.productId],
      allowDiscountCodes: true,
      customerId,
    });

    await scheduleBillingOutcome(ctx, {
      flow: "checkout",
      outcome: "success",
      userId,
    });
    return checkout.url;
  } catch (error) {
    await scheduleBillingOutcome(ctx, {
      errorClass: normalizeErrorClass(error),
      flow: "checkout",
      outcome: "failure",
      userId,
    });
    throw error;
  }
};

export const createCheckoutLink = action({
  args: { productId: v.string() },
  returns: v.string(),
  handler: createCheckoutLinkHandler,
});

export const createCustomerPortalHandler = async (ctx: any) => {
  let userId: string | undefined;
  try {
    const user = await ctx.runQuery(api.billing.getUserInfo);
    userId = user.teakUserId;
    await scheduleBillingOutcome(ctx, {
      flow: "portal",
      outcome: "attempt",
      userId,
    });

    const subscription = await polar.getCurrentSubscription(ctx, {
      userId: user.teakUserId,
    });
    if (!subscription?.customerId) {
      throw new ConvexError("No active subscription found");
    }

    const polarSdk = new PolarBilling({
      accessToken: env.POLAR_ACCESS_TOKEN ?? "",
      server: env.POLAR_SERVER === "production" ? "production" : "sandbox",
    });

    const result = await polarSdk.customerSessions.create({
      customerId: subscription.customerId,
    });

    await scheduleBillingOutcome(ctx, {
      flow: "portal",
      outcome: "success",
      userId,
    });
    return result.customerPortalUrl;
  } catch (error) {
    await scheduleBillingOutcome(ctx, {
      errorClass: normalizeErrorClass(error),
      flow: "portal",
      outcome: "failure",
      userId,
    });
    throw error;
  }
};

export const createCustomerPortal = action({
  args: {},
  returns: v.string(),
  handler: createCustomerPortalHandler,
});
