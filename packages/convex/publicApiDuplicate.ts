import { internal } from "./_generated/api";
import { type ActionCtx, httpAction } from "./_generated/server";
import { withAuthorizedUser } from "./publicApiHttpAuth";
import { json, withPublicApiGatewayHeaders } from "./publicApiMeta";
import { isSafeExternalUrl } from "./shared/utils/safeUrl";
import type { WorkosResource } from "./workosTokens";

export async function handleDuplicateCardRequest(
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> {
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }
  const url = new URL(request.url).searchParams.get("url")?.trim();
  if (!url || url.length > 8192 || !isSafeExternalUrl(url)) {
    return json(400, {
      code: "INVALID_INPUT",
      error: "Provide an HTTP or HTTPS URL",
    });
  }
  const card = await ctx.runQuery(
    internal.card.findDuplicateCard.findDuplicateCardForUser,
    {
      userId: auth.validated.userId,
      url,
    }
  );
  return json(200, { cardId: card?._id ?? null });
}

export const duplicateCardV1 = httpAction(async (ctx, request) =>
  withPublicApiGatewayHeaders(await handleDuplicateCardRequest(ctx, request))
);
