import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalAction } from "../_generated/server";

// Operator-only backup interface. Callers encrypt each page immediately and keep
// the eight models separate; never write these sensitive rows to application storage.
export const page = internalAction({
  args: {
    model: v.union(
      v.literal("user"),
      v.literal("account"),
      v.literal("session"),
      v.literal("verification"),
      v.literal("oauthApplication"),
      v.literal("oauthAccessToken"),
      v.literal("oauthConsent"),
      v.literal("jwks")
    ),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    page: v.array(v.any()),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { model, cursor }) => {
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model,
      paginationOpts: { cursor, numItems: 100 },
    });
    return {
      page: result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
