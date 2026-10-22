import { describe, expect, test } from "bun:test";
import {
  parseSearchUrlState,
  type SearchUrlState,
  serializeSearchUrlState,
} from "../searchUrlState";
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
      filtersChanged: false,
      sortChanged: false,
      tagChanged: false,
      typesChanged: false,
    });
    expect(sync.searchSettled(search())?.sortChanged).toBe(true);
  });

  test("never echoes the page's own search back from the URL", () => {
    const sync = createSearchUrlSync(search());
    expect(sync.searchSettled(search({ q: "teak" }))).toEqual({
      filtersChanged: false,
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

  test("never overwrites a long typed search with the shorter one the URL keeps", () => {
    const typed = `${"word ".repeat(120)}end`;
    const sync = createSearchUrlSync(search());
    expect(sync.searchSettled(search({ q: typed }))).not.toBeNull();
    const fromUrl = parseSearchUrlState(
      new URLSearchParams(serializeSearchUrlState(search({ q: typed })))
    );
    expect(fromUrl.q.length).toBeLessThan(typed.length);
    expect(sync.urlReported(fromUrl)).toBeNull();
  });

  test("reads ?q=type:image as the search it already shows with Image picked", () => {
    const sync = createSearchUrlSync(search({ q: "type:image poster" }));
    expect(
      sync.searchSettled(search({ q: "poster", types: ["image"] }))
    ).toBeNull();
  });

  test("a search reported before the URL moved on is not a new change", () => {
    const sync = createSearchUrlSync(search());
    sync.searchSettled(search({ q: "poster" }));
    sync.urlReported(search({ tag: "design" }));
    expect(sync.searchSettled(search({ q: "poster" }))).toBeNull();
    expect(sync.searchSettled(search({ tag: "design" }))).toBeNull();
    expect(sync.searchSettled(search({ q: "poster" }))?.tagChanged).toBe(true);
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
      filtersChanged: false,
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
    ).toEqual({
      filtersChanged: false,
      sortChanged: false,
      tagChanged: true,
      typesChanged: true,
    });
  });

  test("notices new colors, styles and dates", () => {
    expect(
      searchUrlChange(search(), search({ hues: ["red"] })).filtersChanged
    ).toBe(true);
    expect(
      searchUrlChange(search(), search({ styles: ["minimal"] })).filtersChanged
    ).toBe(true);
    expect(
      searchUrlChange(search(), search({ date: "This Week" })).filtersChanged
    ).toBe(true);
    expect(
      searchUrlChange(
        search({ hexes: ["#FF5733"] }),
        search({ hexes: ["#FF5733"] })
      ).filtersChanged
    ).toBe(false);
  });

  test("a type: qualifier and the same picked type are no change", () => {
    expect(
      searchUrlChange(search({ q: "type:image" }), search({ types: ["image"] }))
        .typesChanged
    ).toBe(false);
    expect(
      searchUrlChange(
        search({ q: "type:image" }),
        search({ types: ["image", "link"] })
      ).typesChanged
    ).toBe(true);
  });
});
