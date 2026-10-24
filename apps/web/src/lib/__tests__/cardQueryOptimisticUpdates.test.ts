import { describe, expect, it } from "bun:test";
import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import type { OptimisticLocalStore } from "convex/browser";
import { getFunctionName } from "convex/server";
import {
  addCaptureToSearchQueries,
  addCardToSearchQueries,
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

const isCardDetailQuery = (query: unknown) =>
  getFunctionName(query as typeof api.cards.getCardByUrlId) ===
  getFunctionName(api.cards.getCardByUrlId);

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

  it("reads a smart folder by its search, not by the card's folders", () => {
    const toRead = card({
      content: "https://example.com/book",
      metadata: {
        linkCategory: {
          category: "book",
          fetchedAt: 1,
          sourceUrl: "https://example.com/book",
        },
      },
      type: "link",
      url: "https://example.com/book",
    });
    const smartFolder = {
      folderId: "folder-1" as Id<"folders">,
      folderQuery: "is:todo",
    };
    expect(cardMatchesSearchQuery(toRead, smartFolder)).toBe(true);
    expect(
      cardMatchesSearchQuery({ ...toRead, completedAt: 5 }, smartFolder)
    ).toBe(false);
    expect(
      cardMatchesSearchQuery(toRead, { ...smartFolder, searchQuery: "is:done" })
    ).toBe(false);
    expect(
      cardMatchesSearchQuery(toRead, { folderId: "folder-1" as Id<"folders"> })
    ).toBe(false);
  });

  it("drops a hidden card unless the query names its reserved tag", () => {
    const hidden = card({ tags: ["secret"], isHidden: true });
    expect(cardMatchesSearchQuery(hidden, {})).toBe(false);
    expect(cardMatchesSearchQuery(hidden, { searchQuery: "secret" })).toBe(
      false
    );
    expect(cardMatchesSearchQuery(hidden, { searchQuery: "#secret" })).toBe(
      true
    );
    expect(cardMatchesSearchQuery(hidden, { tag: "Secret" })).toBe(true);
  });

  it("keeps a card the server matched on text the client lacks when another card changes", () => {
    const values: Array<{ page: Doc<"cards">[] }> = [];
    const pdf = card({
      _id: "card-2" as Id<"cards">,
      content: "scan.pdf",
      hasExtractedText: true,
      type: "document",
    });
    const related = {
      ...card({ _id: "card-3" as Id<"cards">, content: "billing" }),
      matchedByMeaning: true,
    };
    let getAllQueriesCall = 0;
    const localStore = {
      getAllQueries: () =>
        getAllQueriesCall++ === 0
          ? []
          : [
              {
                args: {
                  paginationOpts: { cursor: null, numItems: 20 },
                  searchQuery: "invoice",
                },
                value: {
                  continueCursor: null,
                  isDone: true,
                  page: [card({ content: "invoice" }), pdf, related],
                },
              },
            ],
      setQuery: (
        _query: unknown,
        _args: unknown,
        value: { page: Doc<"cards">[] }
      ) => values.push(value),
    } as unknown as OptimisticLocalStore;

    updateCardInSearchQueries(
      localStore,
      "card-1" as Id<"cards">,
      (current) => ({ ...current, isFavorited: false })
    );

    expect(values[0]?.page.map((entry) => entry._id)).toEqual([
      "card-1",
      "card-2",
      "card-3",
    ]);
  });

  it("puts a new card on the first newest-first page of the grids it belongs in", () => {
    const page = (args: Record<string, unknown>, cursor: string | null) => ({
      args: { ...args, paginationOpts: { cursor, numItems: 20 } },
      value: { continueCursor: null, isDone: false, page: [card()] },
    });
    const queries = [
      page({}, null),
      page({}, "next-page"),
      page({ sort: "oldest" }, null),
      page({ searchQuery: "design" }, null),
      page({ favoritesOnly: true }, null),
      page({ types: ["text"] }, null),
    ];
    const written: unknown[] = [];
    let getAllQueriesCall = 0;
    const localStore = {
      getAllQueries: () => (getAllQueriesCall++ === 0 ? [] : queries),
      setQuery: (_query: unknown, args: unknown) => written.push(args),
    } as unknown as OptimisticLocalStore;

    addCardToSearchQueries(
      localStore,
      card({ _id: "new-card" as Id<"cards">, isFavorited: undefined })
    );

    expect(written).toEqual([queries[0].args, queries[5].args]);
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

  it("updates the open card's own query, so its dialog shows the edit at once", () => {
    const written: Array<{ args: unknown; value: unknown }> = [];
    const detail = (id: string) => ({
      args: { id },
      value: { ...card({ _id: id as Id<"cards"> }), fileUrl: "https://f" },
    });
    const localStore = {
      getAllQueries: (query: unknown) =>
        isCardDetailQuery(query)
          ? [
              detail("card-1"),
              detail("card-2"),
              { args: { id: "x" }, value: null },
            ]
          : [],
      setQuery: (_query: unknown, args: unknown, value: unknown) =>
        written.push({ args, value }),
    } as unknown as OptimisticLocalStore;

    updateCardInSearchQueries(
      localStore,
      "card-1" as Id<"cards">,
      (current) => ({ ...current, tags: ["kept"] })
    );

    expect(written).toEqual([
      {
        args: { id: "card-1" },
        value: { ...detail("card-1").value, tags: ["kept"] },
      },
    ]);
  });

  it("leaves the open card's query alone when an update removes the card", () => {
    const written: unknown[] = [];
    const localStore = {
      getAllQueries: (query: unknown) =>
        isCardDetailQuery(query)
          ? [{ args: { id: "card-1" }, value: card() }]
          : [],
      setQuery: (_query: unknown, args: unknown) => written.push(args),
    } as unknown as OptimisticLocalStore;

    updateCardInSearchQueries(localStore, "card-1" as Id<"cards">, () => null);

    expect(written).toEqual([]);
  });
});

describe("a capture being saved from the composer", () => {
  const firstPage = (page: Doc<"cards">[]) => {
    const state = {
      page,
      store: {} as OptimisticLocalStore,
    };
    state.store = {
      getAllQueries: (query: unknown) =>
        getFunctionName(query as typeof api.cards.searchCardsPaginated) ===
        getFunctionName(api.cards.searchCardsPaginated)
          ? [
              {
                args: { paginationOpts: { cursor: null, numItems: 20 } },
                value: { continueCursor: "", isDone: true, page: state.page },
              },
            ]
          : [],
      setQuery: (
        _query: unknown,
        _args: unknown,
        value: { page: Doc<"cards">[] }
      ) => {
        state.page = value.page;
      },
    } as unknown as OptimisticLocalStore;
    return state;
  };
  const link = card({
    _id: "saved-link" as Id<"cards">,
    content: "https://www.example.com/post/",
    isArchived: true,
    isFavorited: undefined,
    type: "link",
    url: "https://www.example.com/post/",
  });
  const note = card({ _id: "note" as Id<"cards">, isFavorited: undefined });

  it("moves a link already in the list to the top instead of adding a second tile", () => {
    const grid = firstPage([note, link]);

    addCaptureToSearchQueries(grid.store, {
      content: "http://example.com/post?utm_source=x",
      id: "optimistic" as Id<"cards">,
      now: 50,
    });

    expect(grid.page.map((entry) => entry._id)).toEqual(["saved-link", "note"]);
    expect(grid.page[0]).toMatchObject({ savedAt: 50, isArchived: undefined });
  });

  it("adds a placeholder tile for a new link or a note", () => {
    for (const content of ["https://example.com/new", "A note about it"]) {
      const grid = firstPage([note, link]);
      addCaptureToSearchQueries(grid.store, {
        content,
        id: "optimistic" as Id<"cards">,
        now: 50,
      });
      expect(grid.page.map((entry) => entry._id)).toEqual([
        "optimistic",
        "note",
        "saved-link",
      ]);
    }
  });

  it("never moves a card in Trash", () => {
    const grid = firstPage([note, { ...link, isDeleted: true }]);
    addCaptureToSearchQueries(grid.store, {
      content: "https://www.example.com/post/",
      id: "optimistic" as Id<"cards">,
      now: 50,
    });
    expect(grid.page[0]._id).toBe("optimistic" as Id<"cards">);
  });
});
