import { useCallback } from "react";
import type { CardsSearchQueryArgs } from "../../hooks/cardsSearchState";
import { useRevisitDeck } from "../../hooks/useRevisitDeck";
import { RevisitDeck } from "./RevisitDeck";

export interface ConnectedRevisitDeckProps {
  onArchive: (cardId: string) => Promise<boolean>;
  onExit: () => void;
  onOpenCard: (cardId: string) => void;
  onStartOver: () => void;
  onUnarchive: (cardId: string) => Promise<boolean>;
  /**
   * The view's cards query, as a Shuffle of the deck's seed; null while the
   * view (a folder) is still loading.
   */
  queryArgs: CardsSearchQueryArgs | null;
}

/** The Revisit deck over a library view, dealt from its Shuffle. */
export function ConnectedRevisitDeck({
  onArchive,
  onExit,
  onOpenCard,
  onStartOver,
  onUnarchive,
  queryArgs,
}: ConnectedRevisitDeckProps) {
  const deck = useRevisitDeck({ onArchive, onUnarchive, queryArgs });
  const { finish } = deck;
  const exit = useCallback(() => {
    finish();
    onExit();
  }, [finish, onExit]);
  return (
    <RevisitDeck
      deck={deck}
      onExit={exit}
      onOpenCard={onOpenCard}
      onStartOver={onStartOver}
      open
    />
  );
}
