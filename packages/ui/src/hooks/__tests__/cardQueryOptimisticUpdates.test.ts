import { describe, expect, it } from "bun:test";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import type { OptimisticLocalStore } from "convex/browser";
import {
  cardMatchesSearchQuery,
  updateCardInSearchQueries,
} from "../cardQueryOptimisticUpdates";

const card = (overrides: Partial<Doc<"cards">> = {}): Doc<"cards"> =>
  ({
    _creationTime: 1,
    _id: "card-1" as Id<"cards">,
    content: "favorite design note",
    createdAt: 1,
    isFavorited: true,
    type: "text",
    updatedAt: 1,
    userId: "user-1",
    ...overrides,
  }) as Doc<"cards">;

describe("card query optimistic updates", () => {
  it("matches the same favorite and search filters as the rendered list", () => {
    expect(cardMatchesSearchQuery(card(), { favoritesOnly: true })).toBe(true);
    expect(
      cardMatchesSearchQuery(card({ isFavorited: false }), {
        favoritesOnly: true,
      })
    ).toBe(false);
    expect(cardMatchesSearchQuery(card(), { searchQuery: "design note" })).toBe(
      true
    );
    expect(cardMatchesSearchQuery(card(), { searchQuery: "missing" })).toBe(
      false
    );
  });

  it("removes an unfavorited card from every active Favorites query", () => {
    const values: Doc<"cards">[][] = [];
    let getAllQueriesCall = 0;
    const localStore = {
      getAllQueries: () =>
        getAllQueriesCall++ === 0
          ? [{ args: { favoritesOnly: true }, value: [card()] }]
          : [],
      setQuery: (_query: unknown, _args: unknown, value: Doc<"cards">[]) =>
        values.push(value),
    } as unknown as OptimisticLocalStore;

    updateCardInSearchQueries(
      localStore,
      "card-1" as Id<"cards">,
      (current) => ({ ...current, isFavorited: false })
    );

    expect(values).toEqual([[]]);
  });

  it("removes an unfavorited card from paginated Favorites pages", () => {
    const values: Array<{ page: Doc<"cards">[] }> = [];
    let getAllQueriesCall = 0;
    const localStore = {
      getAllQueries: () =>
        getAllQueriesCall++ === 0
          ? []
          : [
              {
                args: {
                  favoritesOnly: true,
                  paginationOpts: { cursor: null, numItems: 20 },
                },
                value: {
                  continueCursor: null,
                  isDone: true,
                  page: [card()],
                },
              },
            ],
      setQuery: (
        _query: unknown,
        _args: unknown,
        value: { page: Doc<"cards">[] }
      ) => values.push(value),
    } as unknown as OptimisticLocalStore;

    const updatedCard = updateCardInSearchQueries(
      localStore,
      "card-1" as Id<"cards">,
      (current) => ({ ...current, isFavorited: false })
    );

    expect(updatedCard?.isFavorited).toBe(false);
    expect(values).toEqual([
      {
        continueCursor: null,
        isDone: true,
        page: [],
      },
    ]);
  });
});
