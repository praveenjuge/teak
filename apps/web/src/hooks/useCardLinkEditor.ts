import { api } from "@teak/convex";
import { parseCardLinkIds } from "@teak/convex/shared/cardLinks";
import { useConvex } from "convex/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  CardLinkOptions,
  CardLinkTarget,
} from "../components/text-editor/types";
import { useQuery } from "../lib/convexQueryHooks";

export function useCardLinkEditor({
  currentCardId,
  onOpenCard,
  value,
}: {
  currentCardId?: string;
  onOpenCard?: (cardId: string) => void;
  value: string;
}): CardLinkOptions {
  const convex = useConvex();
  const idsKey = parseCardLinkIds(value).join(",");
  const cardIds = useMemo(() => (idsKey ? idsKey.split(",") : []), [idsKey]);
  const found = useQuery(
    api.cards.getCardLinkTargets,
    cardIds.length > 0 ? { cardIds } : "skip"
  );
  // While a changed id list loads, the last answer stands, so a missing
  // card's pill doesn't flash its stored title.
  const lastTargets = useRef<ReadonlyMap<string, CardLinkTarget>>(undefined);
  const targets = useMemo(() => {
    if (cardIds.length === 0) {
      return;
    }
    return Array.isArray(found)
      ? new Map<string, CardLinkTarget>(
          found.map((target: CardLinkTarget) => [target.id, target])
        )
      : lastTargets.current;
  }, [cardIds, found]);
  useEffect(() => {
    if (targets) {
      lastTargets.current = targets;
    }
  }, [targets]);
  const search = useCallback(
    (query: string) =>
      convex.query(api.cards.searchCardLinkSuggestions, {
        excludeCardId: currentCardId,
        query,
      }),
    [convex, currentCardId]
  );
  return useMemo(
    () => ({ onOpenCard, search, targets }),
    [onOpenCard, search, targets]
  );
}
