import { describe, expect, test } from "bun:test";
import type { SearchUrlState } from "../searchUrlState";
import { createSearchUrlSync, searchUrlChange } from "../searchUrlSync";

const search = (overrides: Partial<SearchUrlState> = {}): SearchUrlState => ({
  q: "",
  sort: "newest",
  tag: "",
  types: [],
  ...overrides,
});

describe("createSearchUrlSync", () => {
  test("shows a new URL's search, and nothing for the URL it started from", () => {
    const sync = createSearchUrlSync(search());
    expect(sync.urlReported(search())).toBeNull();
    expect(sync.urlReported(search({ q: "teak" }))).toEqual({
      keepSearch: false,
      state: search({ q: "teak" }),
    });
  });

  test("keeps typed text when only the types or sort changed in the URL", () => {
    const sync = createSearchUrlSync(search({ q: "teak" }));
    expect(
      sync.urlReported(search({ q: "teak ", types: ["image"] }))?.keepSearch
    ).toBe(true);
  });

  test("can replace the next sort change instead of adding history", () => {
    const sync = createSearchUrlSync(search({ seed: 1, sort: "revisit" }));
    sync.replaceNextSortChange();
    expect(sync.searchSettled(search({ seed: 2, sort: "revisit" }))).toEqual({
      sortChanged: false,
      tagChanged: false,
      typesChanged: false,
    });
    // Only the next change: the one after adds history again.
    expect(sync.searchSettled(search())?.sortChanged).toBe(true);
  });

  test("never echoes the page's own search back from the URL", () => {
    const sync = createSearchUrlSync(search());
    expect(sync.searchSettled(search({ q: "teak" }))).toEqual({
      sortChanged: false,
      tagChanged: false,
      typesChanged: false,
    });
    expect(sync.urlReported(search({ q: "teak" }))).toBeNull();
  });

  test("ignores a URL it already read, even after the page searched since", () => {
    const sync = createSearchUrlSync(search());
    sync.searchSettled(search({ q: "teak" }));
    expect(sync.urlReported(search())).toBeNull();
  });

  test("shows the entry Back lands on when the router never reported it", () => {
    const sync = createSearchUrlSync(search({ seed: 1, sort: "shuffle" }));
    sync.searchSettled(search({ seed: 2, sort: "shuffle" }));
    expect(
      sync.historyLanded(search({ seed: 1, sort: "shuffle" }))?.state.seed
    ).toBe(1);
    expect(sync.urlReported(search({ seed: 1, sort: "shuffle" }))).toBeNull();
  });

  test("does nothing when Back lands on the search already shown", () => {
    const sync = createSearchUrlSync(search({ q: "teak" }));
    expect(sync.historyLanded(search({ q: "teak" }))).toBeNull();
  });

  test("reports a search only once", () => {
    const sync = createSearchUrlSync();
    expect(sync.searchSettled(search({ q: "teak" }))).not.toBeNull();
    expect(sync.searchSettled(search({ q: "teak" }))).toBeNull();
  });
});

describe("searchUrlChange", () => {
  test("is no change from nothing", () => {
    expect(searchUrlChange(null, search({ sort: "oldest" }))).toEqual({
      sortChanged: false,
      tagChanged: false,
      typesChanged: false,
    });
  });

  test("a reshuffle is a new order, unless the URL only lacked a seed", () => {
    const shuffled = search({ seed: 1, sort: "shuffle" });
    expect(
      searchUrlChange(shuffled, search({ seed: 2, sort: "shuffle" }))
        .sortChanged
    ).toBe(true);
    expect(
      searchUrlChange(search({ sort: "shuffle" }), shuffled).sortChanged
    ).toBe(false);
  });

  test("notices new types and a new tag", () => {
    expect(
      searchUrlChange(search(), search({ tag: "design", types: ["image"] }))
    ).toEqual({ sortChanged: false, tagChanged: true, typesChanged: true });
  });
});
