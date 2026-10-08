import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { withAuthorizedUser } from "./publicApiHttpAuth";

export const safariAccountSummary = httpAction(async (ctx, request) => {
  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }
  const profile = await ctx.runQuery(internal.publicApiMe.profileForOwner, {
    teakUserId: auth.validated.userId,
    includeCardCount: true,
  });
  return profile
    ? Response.json(
        { email: profile.email, cardCount: profile.cardCount },
        { headers: { "Cache-Control": "no-store" } }
      )
    : Response.json(
        { error: "invalid_token" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
});
