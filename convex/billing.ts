import { Polar } from "@convex-dev/polar";
import { api, components } from "./_generated/api";
import { query } from "./_generated/server";
import { ConvexError } from 'convex/values';

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

export const generateCheckoutLink = polar.api().generateCheckoutLink;
export const generateCustomerPortalUrl = polar.api().generateCustomerPortalUrl;