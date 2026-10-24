export type CardListSort = "newest" | "oldest" | "relevance" | "shuffle";

export const CARD_LIST_SORTS: readonly CardListSort[] = [
  "newest",
  "oldest",
  "relevance",
  "shuffle",
];

export const normalizeCardListSort = (value: unknown): CardListSort => {
  if (value === "oldest" || value === "relevance" || value === "shuffle") {
    return value;
  }
  return "newest";
};

export const keepsServerOrder = (sort: CardListSort | undefined): boolean =>
  sort === "shuffle" || sort === "relevance";

/**
 * When a card was last saved: `savedAt`, which a re-save moves, or
 * `createdAt` on a row written before `savedAt` existed.
 */
export const savedAtOf = (card: {
  createdAt: number;
  savedAt?: number;
}): number => card.savedAt ?? card.createdAt;

interface SavedCard {
  _creationTime: number;
  createdAt: number;
  savedAt?: number;
}

/** "Newest first" and "Oldest first": by `savedAtOf`, then `_creationTime`. */
export const compareCardsBySavedAt = (
  left: SavedCard,
  right: SavedCard,
  sort: CardListSort
): number => {
  const byDate =
    savedAtOf(left) - savedAtOf(right) ||
    left._creationTime - right._creationTime;
  return sort === "oldest" ? byDate : -byDate;
};
