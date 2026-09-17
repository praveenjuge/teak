import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchBar } from "../SearchBar";

const renderSearchBar = (searchQuery = "") =>
  renderToStaticMarkup(
    <SearchBar
      filterTags={[]}
      hexFilters={[]}
      hueFilters={[]}
      keywordTags={[]}
      onAddFilter={() => {}}
      onClearAll={() => {}}
      onKeyDown={() => {}}
      onRemoveFilter={() => {}}
      onRemoveHexFilter={() => {}}
      onRemoveHueFilter={() => {}}
      onRemoveKeyword={() => {}}
      onRemoveStyleFilter={() => {}}
      onRemoveTimeFilter={() => {}}
      onSearchChange={() => {}}
      onToggleFavorites={() => {}}
      onToggleTrash={() => {}}
      searchQuery={searchQuery}
      showFavoritesOnly={false}
      showTrashOnly={false}
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
