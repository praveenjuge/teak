import { useMutation } from "convex/react";
import { api } from "@teak/convex";
import {
  createCardActions,
  setSentryCaptureFunction,
  type CardActionsConfig,
} from "@teak/convex/shared";
import * as Sentry from "@sentry/nextjs";
import { metrics } from "@/lib/metrics";

// Inject Sentry capture function into shared hook
setSentryCaptureFunction((error, context) => {
  Sentry.captureException(error, context);
});

export function useCardActions(config: CardActionsConfig = {}) {
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const updateCardField = useMutation(api.cards.updateCardField);

  // Wrap the config to add metrics tracking
  const wrappedConfig: CardActionsConfig = {
    ...config,
    onDeleteSuccess: (message) => {
      metrics.cardDeleted("unknown"); // Card type not available here
      config.onDeleteSuccess?.(message);
    },
    onRestoreSuccess: (message) => {
      metrics.cardRestored("unknown");
      config.onRestoreSuccess?.(message);
    },
    onPermanentDeleteSuccess: (message) => {
      metrics.cardPermanentlyDeleted("unknown");
      config.onPermanentDeleteSuccess?.(message);
    },
    onError: (error, operation) => {
      metrics.errorOccurred("api", operation);
      config.onError?.(error, operation);
    },
  };

  return createCardActions(
    { permanentDeleteCard, updateCardField },
    wrappedConfig
  );
}
