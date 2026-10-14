/**
 * Library order: by the date a card was saved, newest first by default, or
 * Shuffle, a stable random order picked by a seed (shuffle.ts).
 */
export type CardListSort = "newest" | "oldest" | "shuffle";

export const CARD_LIST_SORTS: readonly CardListSort[] = [
  "newest",
  "oldest",
  "shuffle",
];

export const normalizeCardListSort = (value: unknown): CardListSort => {
  if (value === "oldest" || value === "shuffle") {
    return value;
  }
  return "newest";
};

/**
 * Newest first, or oldest first; equal dates fall back to insertion order.
 * Shuffle has no date order, so it compares like newest.
 */
export const compareCardsByCreatedAt = (
  left: { _creationTime: number; createdAt: number },
  right: { _creationTime: number; createdAt: number },
  sort: CardListSort
): number => {
  const byDate =
    left.createdAt - right.createdAt ||
    left._creationTime - right._creationTime;
  return sort === "oldest" ? byDate : -byDate;
};
