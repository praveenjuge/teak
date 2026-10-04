import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { readAuthPrimary } from "./env";
import { oauthBearerResponse, parseOAuthBearerToken } from "./oauthTokens";
import { withAuthorizedUser } from "./publicApiHttpAuth";

export const safariAccountSummary = httpAction(async (ctx, request) => {
  if (readAuthPrimary() === "workos") {
    const auth = await withAuthorizedUser(ctx, request);
    if ("error" in auth) {
      return auth.error;
    }
    const profile = await ctx.runQuery(internal.publicApiMe.profileForOwner, {
      teakUserId: auth.validated.userId,
      includeCardCount: true,
    });
    return oauthBearerResponse(
      profile ? { email: profile.email, cardCount: profile.cardCount } : null
    );
  }
  const token = parseOAuthBearerToken(request);
  const summary = token
    ? await ctx.runQuery(internal.oauthTokens.getSafariAccountSummary, {
        token,
      })
    : null;
  return oauthBearerResponse(summary);
});
