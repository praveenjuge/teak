import { internal } from "../../_generated/api";
import type { CardWithUrls } from "../../card/queryUtils";
import { MAX_PINNED_CARDS } from "../../shared/pins";
import { captureBackendEvent } from "../../telemetry/posthog";
import type { PublicApiCall } from "./operation";
import { validatePinOrderPayload } from "./payloads";
import { serializeListCard } from "./serializers";
import { errorResponse, json, mapConvexErrorToResponse } from "./shared";

/** `PUT /v1/cards/pinned/order`. */
export const handlePinnedOrderRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const { ctx, request, userId } = call;
  const payload = call.body;
  const order = validatePinOrderPayload(payload);
  if (!order) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      `Body must include \`cardIds\`: every pinned card's id, at most ${MAX_PINNED_CARDS}`
    );
  }
  try {
    const cards: CardWithUrls[] = await ctx.runMutation(
      internal.publicApi.cardsForUser.reorderPinnedCardsForUser,
      { cardIds: order.cardIds, userId }
    );
    await captureBackendEvent("card_pins_reordered", userId, {
      count: cards.length,
      source: "api",
    });
    return json(200, {
      items: cards.map((card) =>
        serializeListCard(card, request.url, new Set())
      ),
    });
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to reorder pinned cards");
  }
};
