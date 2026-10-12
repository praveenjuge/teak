/** Library order: by the date a card was saved, newest first by default. */
export type CardListSort = "newest" | "oldest";

export const CARD_LIST_SORTS: readonly CardListSort[] = ["newest", "oldest"];

export const normalizeCardListSort = (value: unknown): CardListSort =>
  value === "oldest" ? "oldest" : "newest";

/** Newest first, or oldest first; equal dates fall back to insertion order. */
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
