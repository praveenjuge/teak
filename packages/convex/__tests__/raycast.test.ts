// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { favoriteCardsForUser } from "../raycast";

const runHandler = async (fn: any, ctx: any, args: any) => {
  const handler = (fn as any).handler ?? fn;
  return handler(ctx, args);
};

describe("raycast", () => {
  test("favorite search applies isFavorited filter in each search index", async () => {
    const isFavoritedFilters: string[] = [];
    const searchIndexes: string[] = [];

    const ctx = {
      db: {
        query: () => ({
          withSearchIndex: (indexName: string, cb: (q: any) => void) => {
            searchIndexes.push(indexName);
            const queryBuilder = {
              search: () => queryBuilder,
              eq: (field: string, value: unknown) => {
                if (field === "isFavorited" && value === true) {
                  isFavoritedFilters.push(indexName);
                }
                return queryBuilder;
              },
            };
            cb(queryBuilder);
            return {
              take: async () => [],
            };
          },
        }),
      },
    };

    const result = await runHandler(favoriteCardsForUser, ctx, {
      userId: "user_1",
      searchQuery: "design",
      limit: 50,
    });

    expect(result).toEqual([]);
    expect(searchIndexes.length).toBe(8);
    expect(isFavoritedFilters).toHaveLength(8);
    for (const indexName of searchIndexes) {
      expect(isFavoritedFilters).toContain(indexName);
    }
  });
});
