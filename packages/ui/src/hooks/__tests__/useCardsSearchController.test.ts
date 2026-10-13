import { describe, expect, it } from "bun:test";
import type { CardsSearchState } from "../useCardsSearchController";
import {
  applyBackspaceToCardsSearchState,
  applyEnterToCardsSearchState,
  buildCardsSearchQueryArgs,
  buildCardsSearchResetKey,
  createInitialCardsSearchState,
} from "../useCardsSearchController";

const baseState = (): CardsSearchState => createInitialCardsSearchState();

describe("useCardsSearchController helpers", () => {
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

  it("removes chips in web-priority order on Backspace", () => {
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
    expect(state.showTrashOnly).toBe(false);
    state = applyBackspaceToCardsSearchState(state);
    expect(state.showFavoritesOnly).toBe(false);
    state = applyBackspaceToCardsSearchState(state);
    expect(state.filterTags).toEqual([]);
    state = applyBackspaceToCardsSearchState(state);
    expect(state.timeFilter).toBeNull();
    state = applyBackspaceToCardsSearchState(state);
    expect(state.keywordTags).toEqual([]);
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

    // Types go first, then the tag, then the time filter and keywords.
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
