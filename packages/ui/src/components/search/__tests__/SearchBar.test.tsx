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
    expect(markup).toContain('toolname="teak_search_cards"');
    expect(markup).toContain("tooldescription=");
    expect(markup).toContain('name="q"');
  });

  test("wraps the form in a search landmark", () => {
    const markup = renderSearchBar("keyboards");
    expect(markup).toContain("<search>");
  });
});
