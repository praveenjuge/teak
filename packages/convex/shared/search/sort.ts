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
