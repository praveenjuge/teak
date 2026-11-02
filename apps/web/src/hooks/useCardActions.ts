import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useCallback, useRef } from "react";
import {
  applyCardFieldUpdate,
  type CardFieldChange,
  updateCardInSearchQueries,
} from "../lib/cardQueryOptimisticUpdates";
import { type CardActionsConfig, createCardActions } from "./cardActions";

interface UiCardActionsConfig extends CardActionsConfig {
  onCardUpdate?: (card: Doc<"cards">) => void;
}

export function useCardActions(config: UiCardActionsConfig = {}) {
  const { onCardUpdate, ...cardActionsConfig } = config;
  const t = useTranslations("hooks.cardActions");
  const permanentDeleteCard = useMutation(
    api.cards.permanentDeleteCard
  ).withOptimisticUpdate((localStore, { id }) => {
    updateCardInSearchQueries(localStore, id, () => null);
  });
  // Convex runs the optimistic update inside the mutation call and replays
  // it as results arrive, so it only records the change here; the caller's
  // own cache hears about it once per edit, and again if the edit fails.
  const optimisticChange = useRef<CardFieldChange | null>(null);
  const runUpdateCardField = useMutation(
    api.cards.updateCardField
  ).withOptimisticUpdate((localStore, args) => {
    const change = applyCardFieldUpdate(localStore, args);
    optimisticChange.current ??= change;
  });
  const updateCardField = useCallback(
    async (args: FunctionArgs<typeof api.cards.updateCardField>) => {
      optimisticChange.current = null;
      const result = runUpdateCardField(args);
      const change = optimisticChange.current as CardFieldChange | null;
      optimisticChange.current = null;
      if (change) {
        onCardUpdate?.(change.after);
      }
      try {
        return await result;
      } catch (error) {
        if (change) {
          onCardUpdate?.(change.before);
        }
        throw error;
      }
    },
    [onCardUpdate, runUpdateCardField]
  );

  return createCardActions(
    { permanentDeleteCard, updateCardField },
    cardActionsConfig,
    t
  );
}
