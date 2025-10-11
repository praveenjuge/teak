import { useMutation } from "convex/react";
import { api } from "@teak/convex";
import {
  createCardActions,
  type CardActionsConfig,
} from "@teak/shared";

export function useCardActions(config: CardActionsConfig = {}) {
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const updateCardField = useMutation(api.cards.updateCardField);

  return createCardActions(
    { permanentDeleteCard, updateCardField },
    config
  );
}
