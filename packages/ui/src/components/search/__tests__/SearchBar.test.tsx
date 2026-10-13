import { describe, expect, test } from "bun:test";
import type { CardType } from "@teak/convex/shared/constants";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchBar } from "../SearchBar";

const renderSearchBar = (
  searchQuery = "",
  {
    filterTags = [],
    keywordTags = [],
  }: {
    filterTags?: CardType[];
    keywordTags?: string[];
  } = {}
) =>
  renderToStaticMarkup(
    <SearchBar
      filterTags={filterTags}
      hexFilters={[]}
      hueFilters={[]}
      keywordTags={keywordTags}
      leading={<button type="button">Toggle sidebar</button>}
      onClearAll={() => {}}
      onKeyDown={() => {}}
      onRemoveFilter={() => {}}
      onRemoveHexFilter={() => {}}
      onRemoveHueFilter={() => {}}
      onRemoveKeyword={() => {}}
      onRemoveStyleFilter={() => {}}
      onRemoveTimeFilter={() => {}}
      onSearchChange={() => {}}
      placeholder="Search favorites..."
      searchQuery={searchQuery}
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
  // Labels of the chip buttons under the search box.
  const chipLabels = (markup: string) =>
    [...markup.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);

  test("shows no chips while nothing narrows the results", () => {
    const markup = renderSearchBar("typing");
    expect(chipLabels(markup)).toEqual([]);
    expect(markup).not.toContain("Clear all");
  });

  // Views and card types to pick live in the sidebar now.
  test("never offers view or unpicked type chips", () => {
    const markup = renderSearchBar("", { filterTags: ["link"] });
    for (const label of ["Text", "Image", "Favorites", "Trash", "Archived"]) {
      expect(chipLabels(markup)).not.toContain(label);
    }
  });

  test("shows picked types and keywords as removable chips", () => {
    const markup = renderSearchBar("", {
      filterTags: ["link"],
      keywordTags: ["design"],
    });
    expect(chipLabels(markup)).toEqual(["design", "Link"]);
    expect(markup).toContain("Clear all");
  });

  test("renders the leading control and the view's placeholder", () => {
    const markup = renderSearchBar();
    expect(markup.indexOf("Toggle sidebar")).toBeLessThan(
      markup.indexOf('name="q"')
    );
    expect(markup).toContain('placeholder="Search favorites..."');
  });
});
