import { internal } from "../../_generated/api";
import { isSafeExternalUrl } from "../../shared/utils/safeUrl";
import { json } from "./meta";
import { type PublicApiCall, queryOf } from "./operation";

export async function handleDuplicateCardRequest(
  call: PublicApiCall
): Promise<Response> {
  const { ctx, userId } = call;
  const url = queryOf(call).get("url")?.trim();
  if (!url || url.length > 8192 || !isSafeExternalUrl(url)) {
    return json(400, {
      code: "INVALID_INPUT",
      error: "Provide an HTTP or HTTPS URL",
    });
  }
  const card = await ctx.runQuery(
    internal.card.findDuplicateCard.findDuplicateCardForUser,
    {
      userId,
      url,
    }
  );
  return json(200, { cardId: card?._id ?? null });
}
