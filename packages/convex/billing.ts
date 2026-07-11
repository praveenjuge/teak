import { Polar } from "@convex-dev/polar";
import { Polar as PolarBilling } from "@polar-sh/sdk";
import { ConvexError, v } from "convex/values";
import { api, components } from "./_generated/api";
import { action, query } from "./_generated/server";
import { resolveTeakDevAppUrl } from "./devUrls";
import { normalizeErrorClass } from "./shared/telemetry";
import { scheduleBillingOutcome } from "./telemetry/schedule";

// User query to use in the Polar component
export const getUserInfoHandler = async (ctx: any) => {
  const user = await ctx.auth.getUserIdentity();
  if (!user) {
    throw new ConvexError("User not found");
  }
  return user;
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
    userId: user.subject,
    email: user.email,
  };
};

export const polar = new Polar(components.polar, {
  getUserInfo: polarUserInfoProvider,
});

export const createCheckoutLinkHandler = async (ctx: any, args: any) => {
  let userId: string | undefined;
  try {
    const devAppUrl = resolveTeakDevAppUrl(process.env);
    const user = await ctx.runQuery(api.billing.getUserInfo);
    userId = user.subject;
    await scheduleBillingOutcome(ctx, {
      flow: "checkout",
      outcome: "attempt",
      userId,
    });

    const polar = new PolarBilling({
      accessToken: process.env.POLAR_ACCESS_TOKEN ?? "",
      server:
        process.env.POLAR_SERVER === "production" ? "production" : "sandbox",
    });

    const dbCustomer = await ctx.runQuery(
      components.polar.lib.getCustomerByUserId,
      {
        userId: user.subject,
      }
    );
    const createCustomer = async () => {
      const customer = await polar.customers.create({
        email: user.email as string,
        metadata: {
          userId: user.subject,
        },
      });
      if (!customer.id) {
        throw new Error("Customer not created");
      }
      return customer.id;
    };
    const customerId = dbCustomer?.id || (await createCustomer());

    if (!dbCustomer) {
      await ctx.runMutation(components.polar.lib.insertCustomer, {
        id: customerId,
        userId: user.subject,
      });
    }

    const checkout = await polar.checkouts.create({
      products: [args.productId],
      allowDiscountCodes: true,
      customerId,
      embedOrigin:
        process.env.POLAR_SERVER === "production"
          ? "https://app.teakvault.com"
          : devAppUrl,
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
    userId = user.subject;
    await scheduleBillingOutcome(ctx, {
      flow: "portal",
      outcome: "attempt",
      userId,
    });

    const subscription = await polar.getCurrentSubscription(ctx, {
      userId: user.subject,
    });
    if (!subscription?.customerId) {
      throw new ConvexError("No active subscription found");
    }

    const polarSdk = new PolarBilling({
      accessToken: process.env.POLAR_ACCESS_TOKEN ?? "",
      server:
        process.env.POLAR_SERVER === "production" ? "production" : "sandbox",
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
