import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { oauthBearerResponse, parseOAuthBearerToken } from "./oauthTokens";

export const oauthUserInfo = httpAction(async (ctx, request) => {
  const token = parseOAuthBearerToken(request);
  const user = token
    ? await ctx.runQuery(api.oauthTokens.getOAuthUserInfo, { token })
    : null;
  return oauthBearerResponse(user);
});
