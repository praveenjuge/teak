import { useMutation } from "convex/react";
import { api } from "@teak/convex";
import {
  createCardActions,
  setSentryCaptureFunction,
  type CardActionsConfig,
} from "@teak/convex/shared";
import * as Sentry from "@sentry/nextjs";

// Inject Sentry capture function into shared hook
setSentryCaptureFunction((error, context) => {
  Sentry.captureException(error, context);
});

export function useCardActions(config: CardActionsConfig = {}) {
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const updateCardField = useMutation(api.cards.updateCardField);

  return createCardActions(
    { permanentDeleteCard, updateCardField },
    config
  );
}
