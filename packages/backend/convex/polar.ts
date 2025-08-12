import { Polar } from "@convex-dev/polar";
import { api, components } from "./_generated/api";
import { query } from "./_generated/server";
import { ConvexError, v } from 'convex/values';

// User query to use in the Polar component
export const getUserInfo = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User not found");
    }
    return user;
  },
});

export const polar = new Polar(components.polar, {
  getUserInfo: async (
    ctx
  ): Promise<{ userId: string; email: string; name?: string }> => {
    const user = await ctx.runQuery(api.polar.getUserInfo);
    if (!user?.email) {
      throw new ConvexError(
        "User not found"
      );
    }

    return {
      userId: user.subject,
      email: user.email,
    };
  },
});

export const {
  getConfiguredProducts,
  listAllProducts,
  // Generates a checkout link for the given product IDs.
  generateCheckoutLink,
  // Generates a customer portal URL for the current user.
  generateCustomerPortalUrl,
  // Changes the current subscription to the given product ID.
  changeCurrentSubscription,
  // Cancels the current subscription.
  cancelCurrentSubscription,
} = polar.api();

export const userHasPremium = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return false;
    }

    try {
      const subscription = await polar.getCurrentSubscription(ctx, { userId: user.subject });
      return subscription?.status === 'active';
    } catch {
      return false;
    }
  },
});