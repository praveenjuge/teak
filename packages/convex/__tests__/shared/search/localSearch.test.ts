import { describe, expect, it } from "bun:test";

import type { Doc, Id } from "../../../_generated/dataModel";
import {
  buildSearchableText,
  classifySearchToken,
  filterLocalCards,
  mergeCardsIntoLocalSearchCache,
  mergeLocalAndRemoteSearchResults,
  pruneCardsMissingFromRemote,
  resolveQuickSearchCommand,
  tokenizeSearchQuery,
} from "../../../shared/search";

type CardOverrides = Partial<Omit<Doc<"cards">, "_id">> & {
  _id?: Id<"cards"> | string;
};

const makeId = (value: string) => value as Id<"cards">;

const makeCard = (overrides: CardOverrides): Doc<"cards"> =>
  ({
    _id: overrides._id ? (overrides._id as Id<"cards">) : makeId("card"),
    _creationTime: 0,
    userId: "user",
    content: "",
    type: "text",
    metadata: {} as any,
    fileMetadata: {} as any,
    processingStatus: {} as any,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }) as Doc<"cards">;

describe("shared search helpers", () => {
  it("orders local results by saved date in the requested direction", () => {
    const cards = [
      makeCard({ _id: "added-first", _creationTime: 1, createdAt: 3000 }),
      makeCard({ _id: "imported", _creationTime: 3, createdAt: 1000 }),
      makeCard({ _id: "twin-a", _creationTime: 4, createdAt: 2000 }),
      makeCard({ _id: "twin-b", _creationTime: 5, createdAt: 2000 }),
    ];
    const ids = (sort?: "newest" | "oldest") =>
      filterLocalCards([...cards], { sort }).map((card) => card._id);

    expect(ids()).toEqual(["added-first", "twin-b", "twin-a", "imported"]);
    expect(ids("oldest")).toEqual([
      "imported",
      "twin-a",
      "twin-b",
      "added-first",
    ]);
  });

  it("merges local and remote hits in saved-date order", () => {
    const local = [
      makeCard({ _id: "cached-old", createdAt: 1000 }),
      makeCard({ _id: "both", createdAt: 2000 }),
    ];
    const remote = [
      makeCard({ _id: "remote-new", createdAt: 3000 }),
      makeCard({ _id: "both", createdAt: 2000 }),
    ];
    const ids = (sort: "newest" | "oldest") =>
      mergeLocalAndRemoteSearchResults(remote, local, true, sort).map(
        (card) => card._id
      );
    expect(ids("newest")).toEqual(["remote-new", "both", "cached-old"]);
    expect(ids("oldest")).toEqual(["cached-old", "both", "remote-new"]);
  });

  it("keeps the server's shuffled order and adds local hits after it", () => {
    const remote = [
      makeCard({ _id: "b", createdAt: 1000 }),
      makeCard({ _id: "c", createdAt: 3000 }),
      makeCard({ _id: "a", createdAt: 2000 }),
    ];
    const local = [
      makeCard({ _id: "cached", createdAt: 4000 }),
      makeCard({ _id: "a", createdAt: 2000 }),
    ];
    const ids = (hasActiveSearch: boolean) =>
      mergeLocalAndRemoteSearchResults(
        remote,
        local,
        hasActiveSearch,
        "shuffle"
      ).map((card) => card._id);
    expect(ids(true)).toEqual(["b", "c", "a", "cached"]);
    expect(ids(false)).toEqual(["b", "c", "a"]);
    expect(
      filterLocalCards(remote, { searchTerms: "", sort: "shuffle" }).map(
        (card) => card._id
      )
    ).toEqual(["b", "c", "a"]);
  });

  it("reorders the shown library at once when the sort changes", () => {
    // Still the newest-first page while the oldest-first one loads.
    const shown = [
      makeCard({ _id: "new", createdAt: 3000 }),
      makeCard({ _id: "old", createdAt: 1000 }),
    ];
    expect(
      mergeLocalAndRemoteSearchResults(shown, [], false, "oldest").map(
        (card) => card._id
      )
    ).toEqual(["old", "new"]);
  });

  it("tokenizes and normalizes search terms", () => {
    expect(tokenizeSearchQuery("  Foo   BAR ")).toEqual(["foo", "bar"]);
  });

  it("trims configured punctuation without regex backtracking", () => {
    expect(tokenizeSearchQuery(`  !!!"Foo,"   [bar]...  `)).toEqual([
      "foo",
      "bar",
    ]);
    expect(classifySearchToken("(((#663399)))")).toEqual({
      kind: "hex",
      value: "#663399",
    });
  });

  it("classifies style/hue/hex/keyword tokens", () => {
    expect(classifySearchToken("vintage")).toEqual({
      kind: "style",
      value: "vintage",
    });
    expect(classifySearchToken("violet")).toEqual({
      kind: "hue",
      value: "purple",
    });
    expect(classifySearchToken("663399")).toEqual({
      kind: "hex",
      value: "#663399",
    });
    expect(classifySearchToken("mytag")).toEqual({
      kind: "keyword",
      value: "mytag",
    });
  });

  it("resolves quick commands", () => {
    expect(resolveQuickSearchCommand("favorites")).toBe("favorites");
    expect(resolveQuickSearchCommand("trash")).toBe("trash");
    expect(resolveQuickSearchCommand("other")).toBeNull();
  });

  it("builds searchable text from core fields and tags", () => {
    const card = makeCard({
      content: "Hello",
      notes: "World",
      tags: ["Alpha"],
      aiTags: ["Beta"],
    });

    const text = buildSearchableText(card);
    expect(text).toContain("hello");
    expect(text).toContain("world");
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
  });

  it("filters by search terms across fields", () => {
    const cards = [
      makeCard({
        _id: "1",
        content: "Alpha beta",
        createdAt: 1,
        updatedAt: 1,
      }),
      makeCard({
        _id: "2",
        notes: "Gamma",
        createdAt: 2,
        updatedAt: 2,
      }),
    ];

    const results = filterLocalCards(cards, { searchTerms: "beta" });
    expect(results.map((card) => card._id)).toEqual(["1"]);
  });

  it("respects type, favorites, and trash filters", () => {
    const cards = [
      makeCard({
        _id: "1",
        type: "link",
        isFavorited: true,
        createdAt: 2,
        updatedAt: 2,
      }),
      makeCard({
        _id: "2",
        type: "text",
        isFavorited: true,
        createdAt: 1,
        updatedAt: 1,
      }),
      makeCard({
        _id: "3",
        type: "link",
        isDeleted: true,
        createdAt: 3,
        updatedAt: 3,
      }),
    ];

    const results = filterLocalCards(cards, {
      types: ["link"],
      favoritesOnly: true,
      showTrashOnly: false,
    });
    expect(results.map((card) => card._id)).toEqual(["1"]);

    const trashResults = filterLocalCards(cards, {
      showTrashOnly: true,
    });
    expect(trashResults.map((card) => card._id)).toEqual(["3"]);
  });

  it("sorts results by createdAt descending", () => {
    const cards = [
      makeCard({ _id: "1", content: "Alpha", createdAt: 10, updatedAt: 10 }),
      makeCard({ _id: "2", content: "Alpha", createdAt: 30, updatedAt: 30 }),
      makeCard({ _id: "3", content: "Alpha", createdAt: 20, updatedAt: 20 }),
    ];

    const results = filterLocalCards(cards, { searchTerms: "alpha" });
    expect(results.map((card) => card._id)).toEqual(["2", "3", "1"]);
  });

  it("filters by normalized visual style on image cards", () => {
    const cards = [
      makeCard({
        _id: "1",
        type: "image",
        visualStyles: ["vintage"],
        createdAt: 10,
        updatedAt: 10,
      }),
      makeCard({
        _id: "2",
        type: "palette",
        visualStyles: ["vintage"],
        createdAt: 9,
        updatedAt: 9,
      }),
    ];

    const results = filterLocalCards(cards, {
      styleFilters: ["  Vintage  "],
    });
    expect(results.map((card) => card._id)).toEqual(["1"]);
  });

  it("filters by normalized hue and hex on image, palette and video cards", () => {
    const cards = [
      makeCard({
        _id: "1",
        type: "image",
        colorHues: ["purple"],
        colorHexes: ["#663399"],
        createdAt: 3,
        updatedAt: 3,
      }),
      makeCard({
        _id: "2",
        type: "palette",
        colorHues: ["purple"],
        colorHexes: ["#663399"],
        createdAt: 2,
        updatedAt: 2,
      }),
      makeCard({
        _id: "3",
        type: "text",
        colorHues: ["purple"],
        colorHexes: ["#663399"],
        createdAt: 1,
        updatedAt: 1,
      }),
      makeCard({
        _id: "4",
        type: "video",
        colorHues: ["purple"],
        colorHexes: ["#663399"],
        createdAt: 0,
        updatedAt: 0,
      }),
    ];

    const results = filterLocalCards(cards, {
      hueFilters: ["violet"],
      hexFilters: ["663399"],
    });
    expect(results.map((card) => card._id)).toEqual(["1", "2", "4"]);
  });

  it("merges local and remote search results without duplicates", () => {
    const localResults = [
      makeCard({
        _id: "1",
        content: "Local first",
        createdAt: 2,
        updatedAt: 2,
      }),
    ];
    const remoteResults = [
      makeCard({
        _id: "1",
        content: "Remote duplicate",
        createdAt: 2,
        updatedAt: 3,
      }),
      makeCard({
        _id: "2",
        content: "Remote unique",
        createdAt: 1,
        updatedAt: 1,
      }),
    ];

    const merged = mergeLocalAndRemoteSearchResults(
      remoteResults,
      localResults,
      true
    );
    expect(merged.map((card) => card._id)).toEqual(["1", "2"]);
  });

  it("returns an empty list when neither local nor remote matches", () => {
    const cards = [
      makeCard({
        _id: "1",
        content: "Alpha",
        type: "text",
        tags: ["design"],
        createdAt: 1,
        updatedAt: 1,
      }),
      makeCard({
        _id: "2",
        content: "Beta",
        type: "link",
        isFavorited: true,
        createdAt: 2,
        updatedAt: 2,
      }),
    ];

    const noMatches = filterLocalCards(cards, {
      searchTerms: "zzzz-no-match",
    });
    expect(noMatches).toEqual([]);

    const mergedEmpty = mergeLocalAndRemoteSearchResults([], [], true);
    expect(mergedEmpty).toEqual([]);
  });

  it("combines type, tag, and trash filters without leaking active cards", () => {
    const cards = [
      makeCard({
        _id: "active-link",
        type: "link",
        tags: ["prod"],
        createdAt: 3,
        updatedAt: 3,
      }),
      makeCard({
        _id: "trashed-link",
        type: "link",
        tags: ["prod"],
        isDeleted: true,
        createdAt: 2,
        updatedAt: 2,
      }),
      makeCard({
        _id: "trashed-text",
        type: "text",
        tags: ["prod"],
        isDeleted: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    ];

    const results = filterLocalCards(cards, {
      types: ["link"],
      searchTerms: "prod",
      showTrashOnly: true,
    });
    expect(results.map((card) => card._id)).toEqual(["trashed-link"]);
  });

  it("updates local cache by id+updatedAt and enforces max size", () => {
    const current = [
      makeCard({
        _id: "1",
        createdAt: 3,
        updatedAt: 3,
      }),
      makeCard({
        _id: "2",
        createdAt: 2,
        updatedAt: 2,
      }),
    ];
    const incoming = [
      makeCard({
        _id: "2",
        createdAt: 2,
        updatedAt: 4,
      }),
      makeCard({
        _id: "3",
        createdAt: 1,
        updatedAt: 1,
      }),
    ];

    const next = mergeCardsIntoLocalSearchCache(current, incoming, 2);
    expect(next.map((card) => card._id)).toEqual(["1", "2"]);
    expect(next.find((card) => card._id === "2")?.updatedAt).toBe(4);
  });

  it("drops cached cards that the same remote query stopped returning", () => {
    const cache = [
      makeCard({ _id: "kept", content: "design" }),
      makeCard({ _id: "deleted", content: "design" }),
      makeCard({ _id: "other-query", content: "design" }),
    ];
    const previousRemoteIds = new Set(["kept", "deleted"]);
    const nextRemote = [makeCard({ _id: "kept", content: "design" })];

    const next = pruneCardsMissingFromRemote(
      cache,
      previousRemoteIds,
      nextRemote
    );

    expect(next.map((card) => card._id)).toEqual(["kept", "other-query"]);
    expect(
      filterLocalCards(next, { searchTerms: "design" }).map((card) => card._id)
    ).not.toContain("deleted");
  });

  it("keeps the cache untouched when no remote card went missing", () => {
    const cache = [makeCard({ _id: "a" }), makeCard({ _id: "b" })];
    const next = pruneCardsMissingFromRemote(cache, new Set(["a"]), [
      makeCard({ _id: "a" }),
      makeCard({ _id: "c" }),
    ]);
    expect(next).toBe(cache);
  });
});

describe("filterLocalCards qualifiers", () => {
  const cards = [
    makeCard({
      _id: "repo",
      type: "link",
      content: "Design system repo",
      url: "https://www.github.com/acme/ds",
      tags: ["Design"],
      createdAt: 4,
    }),
    makeCard({
      _id: "fav",
      type: "link",
      content: "System design blog",
      url: "https://blog.example.com",
      tags: ["design", "writing"],
      isFavorited: true,
      createdAt: 3,
    }),
    makeCard({
      _id: "note",
      content: "design system notes",
      tags: ["design"],
      createdAt: 2,
    }),
    makeCard({
      _id: "archived",
      type: "link",
      content: "Old repo",
      url: "https://github.com/old",
      isArchived: true,
      createdAt: 1,
    }),
  ];
  const ids = (searchTerms: string, showTrashOnly = false) =>
    filterLocalCards([...cards], { searchTerms, showTrashOnly }).map(
      (card) => card._id
    );

  it.each([
    ["site:github.com", ["repo"]],
    ["site:GITHUB.com is:archived", ["archived"]],
    ['"design system"', ["repo", "note"]],
    ["tag:design tag:writing", ["fav"]],
    ["#design type:text", ["note"]],
    ["is:fav", ["fav"]],
    ["type:links design", ["repo", "fav"]],
    ["foo:bar", []],
    // Two tags in a row are not a phrase.
    ['"design writing"', []],
  ])("%s", (searchTerms: string, expected: string[]) => {
    expect(ids(searchTerms)).toEqual(expected);
  });
});

describe("filterLocalCards textMatchedByServer", () => {
  it("keeps cards the server matched by text the client lacks; other filters still apply", () => {
    const pdf = makeCard({
      _id: "pdf",
      type: "document",
      content: "supplier-review.pdf",
      hasExtractedText: true,
      createdAt: 2,
    });
    const archived = makeCard({
      _id: "archived",
      type: "document",
      content: "old.pdf",
      hasExtractedText: true,
      isArchived: true,
      createdAt: 1,
    });
    const ids = (cards: Doc<"cards">[]) => cards.map((card) => card._id);
    expect(
      ids(filterLocalCards([pdf, archived], { searchTerms: "kestrel" }))
    ).toEqual([]);
    expect(
      ids(
        filterLocalCards([pdf, archived], {
          searchTerms: '"net 30 days" type:document',
          textMatchedByServer: true,
        })
      )
    ).toEqual(["pdf"]);
    expect(
      ids(
        filterLocalCards([pdf], {
          searchTerms: "kestrel type:image",
          textMatchedByServer: true,
        })
      )
    ).toEqual([]);
  });

  it("still checks every word on cards without file text", () => {
    // The server ranks cards that match only some of the words; a card whose
    // text the client has must still match them all.
    const note = makeCard({ _id: "note", content: "matrix-17" });
    expect(
      filterLocalCards([note], {
        searchTerms: "matrix-17-missing",
        textMatchedByServer: true,
      }).map((card) => card._id)
    ).toEqual([]);
  });
});
