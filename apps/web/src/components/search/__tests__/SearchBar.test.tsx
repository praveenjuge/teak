import { describe, expect, test } from "bun:test";
import type { CardListSort } from "@teak/convex/shared";
import type { CardType } from "@teak/convex/shared/constants";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchBar } from "../SearchBar";
import { viewMenuLabel } from "../ViewMenu";

const renderSearchBar = (
  searchQuery = "",
  {
    filterTags = [],
    keywordTags = [],
    onReshuffle,
    onSortChange,
    onToggleFilter,
    qualifierChips,
    sort,
  }: {
    filterTags?: CardType[];
    keywordTags?: string[];
    onReshuffle?: () => void;
    onSortChange?: (sort: CardListSort) => void;
    onToggleFilter?: (filter: CardType) => void;
    qualifierChips?: string[];
    sort?: CardListSort;
  } = {}
) =>
  renderToStaticMarkup(
    <SearchBar
      filterTags={filterTags}
      hexFilters={[]}
      hueFilters={[]}
      keywordTags={keywordTags}
      leading={<button type="button">Toggle sidebar</button>}
      onClearAll={() => undefined}
      onKeyDown={() => undefined}
      onRemoveFilter={() => undefined}
      onRemoveHexFilter={() => undefined}
      onRemoveHueFilter={() => undefined}
      onRemoveKeyword={() => undefined}
      onRemoveStyleFilter={() => undefined}
      onRemoveTimeFilter={() => undefined}
      onReshuffle={onReshuffle}
      onSearchChange={() => undefined}
      onSortChange={onSortChange}
      onToggleFilter={onToggleFilter}
      placeholder="Search favorites"
      qualifierChips={qualifierChips}
      searchQuery={searchQuery}
      sort={sort}
      styleFilters={[]}
    />
  );

describe("SearchBar WebMCP annotations", () => {
  test("renders the search box as a declarative WebMCP form", () => {
    const markup = renderSearchBar();
    expect(markup).toContain("<form");
    // Distinct from the imperative teak_search_cards tool: WebMCP rejects
    // duplicate tool names.
    expect(markup).toContain('toolname="teak_search_form"');
    expect(markup).toContain("tooldescription=");
    expect(markup).toContain("toolautosubmit");
    expect(markup).toContain('name="q"');
    expect(markup).toContain("toolparamdescription=");
  });

  test("keeps the form a named landmark without extra nesting", () => {
    const markup = renderSearchBar("keyboards");
    expect(markup).toContain('aria-label="Search cards"');
    expect(markup).not.toContain("<search>");
  });
});

describe("SearchBar filter chips", () => {
  const chipNames = (markup: string) =>
    [...markup.matchAll(/aria-label="Remove ([^"]+)"/g)].map(
      (match) => match[1]
    );

  test("shows no chips and nothing to clear while the field is empty", () => {
    const markup = renderSearchBar("");
    expect(chipNames(markup)).toEqual([]);
    expect(markup).not.toContain("Clear all");
  });

  test("offers Clear all once something is typed", () => {
    const markup = renderSearchBar("typing");
    expect(chipNames(markup)).toEqual([]);
    expect(markup).toContain('aria-label="Clear all"');
  });

  test("never offers view or unpicked type chips", () => {
    const names = chipNames(renderSearchBar("", { filterTags: ["link"] }));
    expect(names).toEqual(["type Link"]);
  });

  test("shows keywords and picked types as removable chips in the field", () => {
    const markup = renderSearchBar("", {
      filterTags: ["link"],
      keywordTags: ["design"],
    });
    expect(chipNames(markup)).toEqual(["design", "type Link"]);
    expect(markup).toContain('aria-label="Clear all"');
  });

  test("gives done, to do and archived their own icons", () => {
    const markup = renderSearchBar("", {
      qualifierChips: ["is:done", "is:todo", "is:archived"],
    });
    const icons = [
      ...markup.matchAll(
        /aria-label="Remove ([^"]+)"[\s\S]*?lucide-([a-z-]+)/g
      ),
    ].map((match) => [match[1], match[2]]);
    expect(icons).toEqual([
      ["show Done", "circle-check"],
      ["show To do", "circle"],
      ["show Archived", "archive"],
    ]);
  });

  test("folds chips past the third into a +N menu", () => {
    const markup = renderSearchBar("", {
      filterTags: ["link", "image", "quote"],
      keywordTags: ["design", "ideas"],
    });
    expect(chipNames(markup)).toEqual(["design", "ideas", "type Link"]);
    expect(markup).toContain('aria-label="2 more filters"');
  });

  test("names the search box for the page, ahead of its chips", () => {
    const markup = renderSearchBar("", { keywordTags: ["design"] });
    expect(markup.indexOf("Toggle sidebar")).toBeLessThan(
      markup.indexOf('name="q"')
    );
    expect(markup).toContain('aria-label="Search favorites"');
    expect(markup).toContain('placeholder="Search favorites"');
  });
});

describe("SearchBar View menu", () => {
  test("names the picked types and a changed order on its button", () => {
    const markup = renderSearchBar("", {
      filterTags: ["link", "image"],
      onToggleFilter: () => undefined,
    });
    expect(markup).toContain('aria-label="View: Link, Image"');
    expect(viewMenuLabel(["quote"], "oldest")).toBe(
      "View: Quote, oldest first"
    );
  });

  test("shows Reshuffle beside the View menu only while shuffling", () => {
    const shuffled = renderSearchBar("", {
      onReshuffle: () => undefined,
      onSortChange: () => undefined,
      sort: "shuffle",
    });
    expect(shuffled).toContain('aria-label="Reshuffle"');
    expect(shuffled).toContain('aria-label="View: shuffled"');
    const newest = renderSearchBar("", {
      onReshuffle: () => undefined,
      onSortChange: () => undefined,
    });
    expect(newest).not.toContain('aria-label="Reshuffle"');
  });

  test("reads as the default view when nothing is changed", () => {
    const markup = renderSearchBar("", { onToggleFilter: () => undefined });
    expect(markup).toContain('aria-label="View"');
  });

  test("is left out where the view can't change", () => {
    expect(renderSearchBar("", { filterTags: ["link"] })).not.toContain(
      'aria-label="View'
    );
  });
});

test("the search box takes no more than the URL and search backend keep", () => {
  expect(renderSearchBar()).toContain('maxLength="500"');
});
