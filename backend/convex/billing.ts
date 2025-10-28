import { Polar, PolarComponentApi } from "@convex-dev/polar";
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
    const user = await ctx.runQuery(api.billing.getUserInfo);
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
  generateCheckoutLink,
  generateCustomerPortalUrl,
}: any = polar.api();

export const userHasPremium = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) return false;

    try {
      const subscription = await polar.getCurrentSubscription(ctx, { userId: user.subject });
      return subscription?.status === 'active';
    } catch {
      return false;
    }
  },
});

export const listAllProducts = polar.api().listAllProducts;
