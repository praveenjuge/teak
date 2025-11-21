import { Polar, } from "@convex-dev/polar";
import { api, components } from "./_generated/api";
import { action, query } from "./_generated/server";
import { ConvexError, v } from 'convex/values';
import { Polar as PolarBilling } from "@polar-sh/sdk";

// User query to use in the Polar component
export const getUserInfo = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) throw new ConvexError("User not found");
    return user;
  },
});

export const polar = new Polar(components.polar, {
  getUserInfo: async (
    ctx
  ): Promise<{ userId: string; email: string; name?: string }> => {
    //@ts-ignore
    const user = await ctx.runQuery(api.billing.getUserInfo);
    if (!user?.email) throw new ConvexError("User not found");

    return {
      userId: user.subject,
      email: user.email,
    };
  },
});

export const createCheckoutLink = action({
  args: { productId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(api.billing.getUserInfo);

    const polar = new PolarBilling({
      accessToken: process.env["POLAR_ACCESS_TOKEN"] ?? "",
      server: process.env.POLAR_SERVER === "production" ? "production" : "sandbox"
    });

    const dbCustomer = await ctx.runQuery(
      components.polar.lib.getCustomerByUserId,
      {
        userId: user.subject
      }
    );
    const createCustomer = async () => {
      const customer = await polar.customers.create({
        email: user.email as string,
        metadata: {
          userId: user.subject
        },
      });
      if (!customer.id) {
        console.error(customer);
        throw new Error("Customer not created");
      }
      return customer.id;
    };
    const customerId = dbCustomer?.id || (await createCustomer());

    if (!dbCustomer) {
      await ctx.runMutation(components.polar.lib.insertCustomer, {
        id: customerId,
        userId: user.subject
      });
    }

    const checkout = await polar.checkouts.create({
      products: [args.productId],
      allowDiscountCodes: true,
      customerId,
      embedOrigin: process.env.POLAR_SERVER === "production" ? "https://app.teakvault.com" : "http://localhost:3000"
    });

    return checkout.url;
  },
});

export const createCustomerPortal = action({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const user = await ctx.runQuery(api.billing.getUserInfo);

    const subscription = await polar.getCurrentSubscription(ctx, { userId: user.subject });
    if (!subscription?.customerId) throw new ConvexError("No active subscription found");

    const polarSdk = new PolarBilling({
      accessToken: process.env["POLAR_ACCESS_TOKEN"] ?? "",
      server: process.env.POLAR_SERVER === "production" ? "production" : "sandbox"
    });

    const result = await polarSdk.customerSessions.create({
      customerId: subscription.customerId,
    });

    return result.customerPortalUrl;
  },
});
