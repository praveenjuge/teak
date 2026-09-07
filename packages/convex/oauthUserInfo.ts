import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";

export const oauthUserInfo = httpAction(async (ctx, request) => {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer ([A-Za-z0-9]{32})$/i)?.[1];
  const user = token
    ? await ctx.runQuery(api.oauthTokens.getOAuthUserInfo, { token })
    : null;
  return Response.json(user ?? { error: "invalid_token" }, {
    status: user ? 200 : 401,
    headers: { "Cache-Control": "no-store" },
  });
});
