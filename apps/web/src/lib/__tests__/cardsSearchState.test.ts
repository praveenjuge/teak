import { describe, expect, it } from "bun:test";
import { parseSearchQuery } from "@teak/convex/shared";
import type { CardsSearchState } from "../cardsSearchState";
import {
  applyBackspaceToCardsSearchState,
  applyEnterToCardsSearchState,
  buildCardsSearchQueryArgs,
  buildCardsSearchResetKey,
  buildCardsSearchTerms,
  cardsSearchStateFromQuery,
  createInitialCardsSearchState,
  isSameSearch,
} from "../cardsSearchState";

const baseState = (): CardsSearchState => createInitialCardsSearchState();

describe("cardsSearchState", () => {
  it("parses quick favorites command on Enter", () => {
    const next = applyEnterToCardsSearchState({
      ...baseState(),
      searchQuery: "favorites",
    });

    expect(next.showFavoritesOnly).toBe(true);
    expect(next.searchQuery).toBe("");
  });

  it("parses quick trash command on Enter", () => {
    const next = applyEnterToCardsSearchState({
      ...baseState(),
      searchQuery: "trash",
    });

    expect(next.showTrashOnly).toBe(true);
    expect(next.searchQuery).toBe("");
  });

  it("opens the Archive view with the archive command, never alongside Trash", () => {
    const next = applyEnterToCardsSearchState({
      ...baseState(),
      showTrashOnly: true,
      searchQuery: "archived",
    });

    expect(next.showArchivedOnly).toBe(true);
    expect(next.showTrashOnly).toBe(false);
    expect(buildCardsSearchQueryArgs(next)).toMatchObject({
      showArchivedOnly: true,
    });
    expect(buildCardsSearchQueryArgs(next).showTrashOnly).toBeUndefined();

    const back = applyEnterToCardsSearchState({
      ...next,
      searchQuery: "trash",
    });
    expect(back.showTrashOnly).toBe(true);
    expect(back.showArchivedOnly).toBe(false);
  });

  it("Backspace leaves the Archive view", () => {
    const next = applyBackspaceToCardsSearchState({
      ...baseState(),
      showArchivedOnly: true,
    });
    expect(next.showArchivedOnly).toBe(false);
  });

  it("parses time command on Enter", () => {
    const next = applyEnterToCardsSearchState(
      {
        ...baseState(),
        searchQuery: "today",
      },
      { now: new Date("2026-03-03T00:00:00.000Z"), weekStart: 0 }
    );

    expect(next.timeFilter).not.toBeNull();
    expect(next.searchQuery).toBe("");
  });

  it("adds style/hue/hex/keyword filters on Enter", () => {
    const next = applyEnterToCardsSearchState({
      ...baseState(),
      searchQuery: "vintage violet 663399 focus",
    });

    expect(next.styleFilters).toEqual(["vintage"]);
    expect(next.hueFilters).toEqual(["purple"]);
    expect(next.hexFilters).toEqual(["#663399"]);
    expect(next.keywordTags).toEqual(["focus"]);
    expect(next.searchQuery).toBe("");
  });

  it("removes chips right to left on Backspace, then leaves Favorites and Trash", () => {
    let state: CardsSearchState = {
      ...baseState(),
      keywordTags: ["keyword"],
      filterTags: ["link"],
      styleFilters: ["vintage"],
      hueFilters: ["purple"],
      hexFilters: ["#663399"],
      showFavoritesOnly: true,
      showTrashOnly: true,
      timeFilter: {
        label: "Today",
        range: { start: 1, end: 2 },
      },
    };

    state = applyBackspaceToCardsSearchState(state);
    expect(state.hexFilters).toEqual([]);
    state = applyBackspaceToCardsSearchState(state);
    expect(state.hueFilters).toEqual([]);
    state = applyBackspaceToCardsSearchState(state);
    expect(state.styleFilters).toEqual([]);
    state = applyBackspaceToCardsSearchState(state);
    expect(state.filterTags).toEqual([]);
    state = applyBackspaceToCardsSearchState(state);
    expect(state.timeFilter).toBeNull();
    state = applyBackspaceToCardsSearchState(state);
    expect(state.keywordTags).toEqual([]);
    expect(state.showTrashOnly).toBe(true);
    state = applyBackspaceToCardsSearchState(state);
    expect(state.showTrashOnly).toBe(false);
    state = applyBackspaceToCardsSearchState(state);
    expect(state.showFavoritesOnly).toBe(false);
  });

  it("builds query args and reset key from state", () => {
    const state: CardsSearchState = {
      ...baseState(),
      searchQuery: "focus",
      keywordTags: ["design"],
      filterTags: ["image"],
      styleFilters: ["vintage"],
      hueFilters: ["purple"],
      hexFilters: ["#663399"],
      showFavoritesOnly: true,
      showTrashOnly: false,
      timeFilter: {
        label: "Today",
        range: { start: 10, end: 20 },
      },
    };

    const queryArgs = buildCardsSearchQueryArgs(state);
    expect(queryArgs.searchQuery).toBe("design focus");
    expect(queryArgs.types).toEqual(["image"]);
    expect(queryArgs.styleFilters).toEqual(["vintage"]);
    expect(queryArgs.hueFilters).toEqual(["purple"]);
    expect(queryArgs.hexFilters).toEqual(["#663399"]);
    expect(queryArgs.favoritesOnly).toBe(true);
    expect(queryArgs.showTrashOnly).toBeUndefined();
    expect(queryArgs.createdAtRange).toEqual({ start: 10, end: 20 });

    const resetKey = buildCardsSearchResetKey(state);
    expect(resetKey).toContain("design focus");
    expect(resetKey).toContain("image");
    expect(resetKey).toContain("vintage");
    expect(resetKey).toContain("10-20");
  });

  it("resets to a clean empty-search state for Clear All", () => {
    const cleared = createInitialCardsSearchState();
    expect(cleared).toEqual({
      searchQuery: "",
      keywordTags: [],
      qualifierChips: [],
      filterTags: [],
      styleFilters: [],
      hueFilters: [],
      hexFilters: [],
      showArchivedOnly: false,
      showFavoritesOnly: false,
      showTrashOnly: false,
      tagFilter: "",
      timeFilter: null,
    });
    expect(buildCardsSearchQueryArgs(cleared).searchQuery).toBeUndefined();
    expect(buildCardsSearchQueryArgs(cleared).tag).toBeUndefined();
    expect(buildCardsSearchResetKey(cleared)).toBe(
      "::::::::::false::false::false::::-"
    );
  });

  it("sends a sidebar tag with the query and clears it with Backspace", () => {
    const tagged = { ...baseState(), tagFilter: "design" };
    expect(buildCardsSearchQueryArgs(tagged).tag).toBe("design");
    expect(buildCardsSearchResetKey(tagged)).toContain("::design::");

    const withType = { ...tagged, filterTags: ["link" as const] };
    const afterType = applyBackspaceToCardsSearchState(withType);
    expect(afterType.filterTags).toEqual([]);
    expect(afterType.tagFilter).toBe("design");
    expect(applyBackspaceToCardsSearchState(afterType).tagFilter).toBe("");
  });

  it("keeps type filter chips in query args for image link palette and quote", () => {
    for (const type of ["image", "link", "palette", "quote"] as const) {
      const next = buildCardsSearchQueryArgs({
        ...baseState(),
        filterTags: [type],
      });
      expect(next.types).toEqual([type]);
      expect(next.searchQuery).toBeUndefined();
    }
  });
});

describe("search qualifiers in the controller", () => {
  it("turns qualifiers and phrases into chips on Enter, written canonically", () => {
    const next = applyEnterToCardsSearchState({
      ...baseState(),
      searchQuery:
        'SITE:www.GitHub.com #Design "Design System" type:links notes #fff',
    });
    expect(next.qualifierChips).toEqual([
      "site:github.com",
      "tag:design",
      "type:link",
    ]);
    expect(next.keywordTags).toEqual(['"design system"', "notes"]);
    expect(next.hexFilters).toEqual(["#FFFFFF"]);
    expect(next.searchQuery).toBe("");
    expect(buildCardsSearchQueryArgs(next).searchQuery).toBe(
      'site:github.com tag:design type:link "design system" notes'
    );
  });

  it("keeps quotes inside a phrase chip", () => {
    const next = applyEnterToCardsSearchState({
      ...baseState(),
      searchQuery: '"say \\"hi\\""',
    });
    expect(next.keywordTags).toEqual(['"say \\"hi\\""']);
    expect(
      parseSearchQuery(buildCardsSearchQueryArgs(next).searchQuery ?? "")
        .phrases
    ).toEqual(['say "hi"']);
  });

  it("does not repeat a chip already there", () => {
    const next = applyEnterToCardsSearchState({
      ...baseState(),
      qualifierChips: ["tag:design"],
      searchQuery: "tag:DESIGN folder:Inbox",
    });
    expect(next.qualifierChips).toEqual(["tag:design", "folder:Inbox"]);
  });

  it("removes qualifier chips last with Backspace", () => {
    let state: CardsSearchState = {
      ...baseState(),
      qualifierChips: ["site:github.com", "is:fav"],
      keywordTags: ["notes"],
    };
    state = applyBackspaceToCardsSearchState(state);
    expect(state.keywordTags).toEqual([]);
    state = applyBackspaceToCardsSearchState(state);
    expect(state.qualifierChips).toEqual(["site:github.com"]);
    state = applyBackspaceToCardsSearchState(state);
    expect(state.qualifierChips).toEqual([]);
  });

  it("reads a URL search back into chips and typed text", () => {
    const fromUrl = cardsSearchStateFromQuery(
      'notes folder:"Reading list" "a phrase" site:example.com'
    );
    expect(fromUrl).toEqual({
      keywordTags: ['"a phrase"'],
      qualifierChips: ['folder:"Reading list"', "site:example.com"],
      searchQuery: "notes",
    });
    const terms = buildCardsSearchTerms({ ...baseState(), ...fromUrl });
    expect(
      isSameSearch(
        terms,
        'notes folder:"Reading list" "a phrase" site:example.com'
      )
    ).toBe(true);
    expect(isSameSearch(terms, "notes")).toBe(false);
  });

  it("keeps operators as pills from a URL and through Enter", () => {
    const query = "design -tag:old (site:github.com OR site:gitlab.com) -figma";
    const fromUrl = cardsSearchStateFromQuery(query);
    expect(fromUrl).toEqual({
      keywordTags: ["(site:github.com OR site:gitlab.com)", "-figma"],
      qualifierChips: ["-tag:old"],
      searchQuery: "design",
    });
    const terms = buildCardsSearchTerms({ ...baseState(), ...fromUrl });
    expect(isSameSearch(terms, query)).toBe(true);

    const entered = applyEnterToCardsSearchState({
      ...baseState(),
      searchQuery: query,
    });
    expect(entered.qualifierChips).toEqual(["-tag:old"]);
    expect(entered.keywordTags).toEqual([
      "(site:github.com OR site:gitlab.com)",
      "-figma",
      "design",
    ]);
    expect(entered.searchQuery).toBe("");
    expect(isSameSearch(buildCardsSearchTerms(entered), query)).toBe(true);
  });

  it("a typed OR joins the pills as one group while typing", () => {
    const typing = {
      ...baseState(),
      keywordTags: ["-figma"],
      qualifierChips: ["tag:x"],
      searchQuery: "tag:fonts OR tag:type",
    };
    const terms = buildCardsSearchTerms(typing);
    expect(parseSearchQuery(terms).canonical).toBe(
      "tag:x -figma (tag:fonts OR tag:type)"
    );
    // Enter turns it into the same search.
    expect(
      isSameSearch(
        buildCardsSearchTerms(applyEnterToCardsSearchState(typing)),
        terms
      )
    ).toBe(true);
    // Without pills, the typed text is the search as written.
    expect(
      buildCardsSearchTerms({ ...baseState(), searchQuery: "a OR b" })
    ).toBe("a OR b");
  });

  it("a leading OR beside pills searches what Enter keeps", () => {
    const typing = {
      ...baseState(),
      qualifierChips: ["tag:fonts"],
      searchQuery: "OR tag:type",
    };
    const terms = buildCardsSearchTerms(typing);
    // The pill isn't the OR's left side: Enter keeps both, so both apply.
    expect(parseSearchQuery(terms).canonical).toBe("tag:fonts tag:type");
    expect(
      isSameSearch(
        buildCardsSearchTerms(applyEnterToCardsSearchState(typing)),
        terms
      )
    ).toBe(true);
  });

  it("a lone OR group stays one search after Enter", () => {
    const entered = applyEnterToCardsSearchState({
      ...baseState(),
      qualifierChips: ["tag:x"],
      searchQuery: "tag:fonts OR tag:type",
    });
    expect(entered.keywordTags).toEqual(["(tag:fonts OR tag:type)"]);
    expect(parseSearchQuery(buildCardsSearchTerms(entered)).canonical).toBe(
      "tag:x (tag:fonts OR tag:type)"
    );
  });
});
