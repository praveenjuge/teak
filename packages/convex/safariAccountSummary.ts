import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

export const safariAccountSummary = httpAction(async (ctx, request) => {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9]{32})$/i)?.[1];
  const summary = token
    ? await ctx.runQuery(internal.oauthTokens.getSafariAccountSummary, {
        token,
      })
    : null;
  return Response.json(summary ?? { error: "invalid_token" }, {
    status: summary ? 200 : 401,
    headers: { "Cache-Control": "no-store" },
  });
});
