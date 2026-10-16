/**
 * `relevance` is Best match: a search's results by how well they match, as
 * Clef scored them. Without free words to match it orders like `newest`.
 */
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

/** Sorts whose order comes from the server, not from saved dates. */
export const keepsServerOrder = (sort: CardListSort | undefined): boolean =>
  sort === "shuffle" || sort === "relevance";

/**
 * Newest first, or oldest first; equal dates fall back to insertion order.
 * Shuffle and Best match have no date order, so they compare like newest.
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
