import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import type { CardWithUrls } from "../../card/queryUtils";
import { MAX_PINNED_CARDS } from "../../shared/pins";
import { captureBackendEvent } from "../../telemetry/posthog";
import type { WorkosResource } from "../../workos/tokens";
import { withAuthorizedUser } from "./auth";
import { validatePinOrderPayload } from "./payloads";
import { serializeListCard } from "./serializers";
import {
  errorResponse,
  json,
  mapConvexErrorToResponse,
  parseJsonBody,
} from "./shared";

/** `PUT /v1/cards/pinned/order`. */
export const handlePinnedOrderRequest = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }
  let payload: unknown;
  try {
    payload = await parseJsonBody(request);
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }
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
      { cardIds: order.cardIds, userId: auth.validated.userId }
    );
    await captureBackendEvent("card_pins_reordered", auth.validated.userId, {
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
