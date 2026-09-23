import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { oauthBearerResponse, parseOAuthBearerToken } from "./oauthTokens";

export const safariAccountSummary = httpAction(async (ctx, request) => {
  const token = parseOAuthBearerToken(request);
  const summary = token
    ? await ctx.runQuery(internal.oauthTokens.getSafariAccountSummary, {
        token,
      })
    : null;
  return oauthBearerResponse(summary);
});
