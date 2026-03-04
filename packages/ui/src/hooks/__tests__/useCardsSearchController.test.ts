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
});
