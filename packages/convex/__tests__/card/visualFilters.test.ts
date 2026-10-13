import { describe, expect, test } from "bun:test";
import {
  normalizeVisualFilterArgs,
  runVisualFacetQueries,
} from "../../card/visualFilters";
import { SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION } from "../../shared/search/constants";

describe("card/visualFilters normalizeVisualFilterArgs", () => {
  test("caps hex filters to the per-dimension maximum", () => {
    // Build more unique valid hex values than the cap allows.
    const manyHexes = Array.from(
      { length: SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION + 50 },
      (_, i) => `#${i.toString(16).padStart(6, "0")}`
    );

    const result = normalizeVisualFilterArgs({ hexFilters: manyHexes });

    expect(result.hexFilters?.length).toBe(
      SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION
    );
    expect(result.hasVisualFilters).toBe(true);
  });

  test("still throws on invalid hex values before capping", () => {
    expect(() =>
      normalizeVisualFilterArgs({ hexFilters: ["not-a-hex"] })
    ).toThrow("Invalid hexFilters");
  });

  test("leaves small filter sets unchanged", () => {
    const result = normalizeVisualFilterArgs({
      hexFilters: ["#112233", "#445566"],
      hueFilters: ["blue"],
    });

    expect(result.hexFilters).toEqual(["#112233", "#445566"]);
    expect(result.hueFilters).toEqual(["blue"]);
  });

  test("reports no visual filters when nothing provided", () => {
    const result = normalizeVisualFilterArgs({});
    expect(result.hasVisualFilters).toBe(false);
    expect(result.hexFilters).toBeUndefined();
    expect(result.hueFilters).toBeUndefined();
    expect(result.styleFilters).toBeUndefined();
  });
});

// An in-memory search index: honors the eq filters and matches the search
// term against the array field, the way Convex filters before searching.
const fakeSearchCtx = (cards: Record<string, unknown>[]) => ({
  db: {
    query: () => ({
      withSearchIndex: (_index: string, build: (q: unknown) => unknown) => {
        const filters: [string, unknown][] = [];
        let search: [string, string] | undefined;
        const builder = {
          eq(field: string, value: unknown) {
            filters.push([field, value]);
            return builder;
          },
          search(field: string, term: string) {
            search = [field, term];
            return builder;
          },
        };
        build(builder);
        return {
          take: (limit: number) =>
            Promise.resolve(
              cards
                .filter((card) =>
                  filters.every(([field, value]) => card[field] === value)
                )
                .filter(
                  (card) =>
                    !search ||
                    ((card[search[0]] as string[] | undefined) ?? []).includes(
                      search[1]
                    )
                )
                .slice(0, limit)
            ),
        };
      },
    }),
  },
});

describe("card/visualFilters runVisualFacetQueries archive scope", () => {
  const card = (content: string, extra: Record<string, unknown> = {}) => ({
    _id: content,
    _creationTime: 1,
    content,
    createdAt: 1,
    type: "image",
    userId: "owner",
    colorHues: ["blue"],
    ...extra,
  });
  const cards = [
    card("library"),
    card("archived", { isArchived: true }),
    card("trashed archived", { isArchived: true, isDeleted: true }),
  ];
  const run = async (options: Record<string, unknown>) =>
    (
      await runVisualFacetQueries(fakeSearchCtx(cards), {
        userId: "owner",
        visualFilters: normalizeVisualFilterArgs({ hueFilters: ["blue"] }),
        limit: 10,
        ...options,
      })
    ).map((result) => result.content);

  test("color search leaves archived cards out of the library", async () => {
    expect(await run({})).toEqual(["library"]);
  });

  test("the Archive view finds only archived cards", async () => {
    expect(await run({ archived: "only" })).toEqual(["archived"]);
  });

  test("Trash finds archived cards that are trashed", async () => {
    expect(await run({ showTrashOnly: true })).toEqual(["trashed archived"]);
  });
});
