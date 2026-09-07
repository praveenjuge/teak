import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { withAuthorizedUser } from "./publicApiHttp";
import { json, withPublicApiGatewayHeaders } from "./publicApiMeta";
import { isSafeExternalUrl } from "./shared/utils/safeUrl";

export const duplicateCardV1 = httpAction(async (ctx, request) => {
  const respond = (body: object, status = 200) =>
    withPublicApiGatewayHeaders(json(status, body));
  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return withPublicApiGatewayHeaders(auth.error);
  }
  const url = new URL(request.url).searchParams.get("url");
  if (!url || url.length > 8192 || !isSafeExternalUrl(url)) {
    return respond(
      { code: "INVALID_INPUT", error: "Provide an HTTP or HTTPS URL" },
      400
    );
  }
  const card = await ctx.runQuery(
    internal.card.findDuplicateCard.findDuplicateCardForUser,
    {
      userId: auth.validated.userId,
      url,
    }
  );
  return respond({ cardId: card?._id ?? null });
});
