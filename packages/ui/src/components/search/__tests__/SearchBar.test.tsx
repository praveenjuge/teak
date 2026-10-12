import { describe, expect, test } from "bun:test";
import type { CardType } from "@teak/convex/shared/constants";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchBar } from "../SearchBar";

const renderSearchBar = (
  searchQuery = "",
  {
    filterTags = [],
    showFavoritesOnly = false,
    showTrashOnly = false,
  }: {
    filterTags?: CardType[];
    showFavoritesOnly?: boolean;
    showTrashOnly?: boolean;
  } = {}
) =>
  renderToStaticMarkup(
    <SearchBar
      filterTags={filterTags}
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
      showFavoritesOnly={showFavoritesOnly}
      showTrashOnly={showTrashOnly}
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
  const pressedState = (markup: string, label: string) => {
    const match = markup.match(
      new RegExp(
        `<button[^>]*aria-pressed="(true|false)"[^>]*>(?:(?!</button>).)*<span>${label}</span>`
      )
    );
    return match?.[1];
  };

  test("reports inactive type, Favorites and Trash chips as not pressed", () => {
    const markup = renderSearchBar("x");
    expect(pressedState(markup, "Text")).toBe("false");
    expect(pressedState(markup, "Link")).toBe("false");
    expect(pressedState(markup, "Favorites")).toBe("false");
    expect(pressedState(markup, "Trash")).toBe("false");
  });

  test("reports active type, Favorites and Trash chips as pressed", () => {
    const markup = renderSearchBar("", {
      filterTags: ["link"],
      showFavoritesOnly: true,
      showTrashOnly: true,
    });
    expect(pressedState(markup, "Link")).toBe("true");
    expect(pressedState(markup, "Favorites")).toBe("true");
    expect(pressedState(markup, "Trash")).toBe("true");
    expect(pressedState(markup, "Text")).toBe("false");
  });
});
