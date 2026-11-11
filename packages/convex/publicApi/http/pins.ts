import { internal } from "../../_generated/api";
import type { CardWithUrls } from "../../card/queryUtils";
import { parsePublicApiBody } from "../../shared/publicApiBodies";
import { captureBackendEvent } from "../../telemetry/posthog";
import type { PublicApiCall } from "./operation";
import { serializeListCard } from "./serializers";
import { errorResponse, json } from "./shared";

export const handlePinnedOrderRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const { ctx, request, userId } = call;
  const payload = call.body;
  const parsedOrder = parsePublicApiBody("reorderPinnedCards", payload);
  if ("error" in parsedOrder) {
    return errorResponse(400, "INVALID_INPUT", parsedOrder.error);
  }
  const order = parsedOrder.body;
  const cards: CardWithUrls[] = await ctx.runMutation(
    internal.publicApi.cardsForUser.reorderPinnedCardsForUser,
    { cardIds: order.cardIds, userId }
  );
  await captureBackendEvent("card_pins_reordered", userId, {
    count: cards.length,
    source: "api",
  });
  return json(200, {
    items: cards.map((card) => serializeListCard(card, request.url, new Set())),
  });
};
