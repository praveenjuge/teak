import { Polar, } from "@convex-dev/polar";
import { api, components } from "./_generated/api";
import { action, query } from "./_generated/server";
import { ConvexError, v } from 'convex/values';
import { Polar as PolarBilling } from "@polar-sh/sdk";
import { Sentry, logger, captureException } from "./sentry";

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
    return Sentry.startSpan(
      {
        op: "billing.checkout",
        name: "Create Checkout Link",
      },
      async (span) => {
        span.setAttribute("productId", args.productId);

        try {
          const user = await ctx.runQuery(api.billing.getUserInfo);
          span.setAttribute("userId", user.subject);

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
              logger.error("Customer not created", { response: customer });
              throw new Error(
                `Customer not created: ${JSON.stringify(customer)}`
              );
            }
            return customer.id;
          };
          const customerId = dbCustomer?.id || (await createCustomer());
          span.setAttribute("customerId", customerId);

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

          logger.info("Checkout link created", {
            userId: user.subject,
            productId: args.productId,
            checkoutId: checkout.id,
          });

          return checkout.url;
        } catch (error) {
          captureException(error, {
            productId: args.productId,
            operation: "createCheckoutLink",
          });
          throw error;
        }
      }
    );
  },
});

export const createCustomerPortal = action({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return Sentry.startSpan(
      {
        op: "billing.portal",
        name: "Create Customer Portal",
      },
      async (span) => {
        try {
          const user = await ctx.runQuery(api.billing.getUserInfo);
          span.setAttribute("userId", user.subject);

          const subscription = await polar.getCurrentSubscription(ctx, { userId: user.subject });
          if (!subscription?.customerId) {
            logger.warn("No active subscription found", { userId: user.subject });
            throw new ConvexError("No active subscription found");
          }

          span.setAttribute("customerId", subscription.customerId);

          const polarSdk = new PolarBilling({
            accessToken: process.env["POLAR_ACCESS_TOKEN"] ?? "",
            server: process.env.POLAR_SERVER === "production" ? "production" : "sandbox"
          });

          const result = await polarSdk.customerSessions.create({
            customerId: subscription.customerId,
          });

          logger.info("Customer portal session created", {
            userId: user.subject,
            customerId: subscription.customerId,
          });

          return result.customerPortalUrl;
        } catch (error) {
          captureException(error, { operation: "createCustomerPortal" });
          throw error;
        }
      }
    );
  },
});
