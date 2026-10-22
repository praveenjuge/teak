import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  applyBackspaceToCardsSearchState,
  type CardsSearchState,
  createInitialCardsSearchState,
} from "../../../lib/cardsSearchState";
import { SearchBar } from "../SearchBar";

const noop = () => undefined;

/** The chips' accessible names, in the order the search bar shows them. */
const shownChips = (state: CardsSearchState): string[] => {
  const markup = renderToStaticMarkup(
    <SearchBar
      filterTags={state.filterTags}
      hexFilters={state.hexFilters}
      hueFilters={state.hueFilters}
      keywordTags={state.keywordTags}
      onClearAll={noop}
      onKeyDown={noop}
      onRemoveFilter={noop}
      onRemoveHexFilter={noop}
      onRemoveHueFilter={noop}
      onRemoveKeyword={noop}
      onRemoveStyleFilter={noop}
      onRemoveTimeFilter={noop}
      onSearchChange={noop}
      qualifierChips={state.qualifierChips}
      searchQuery={state.searchQuery}
      styleFilters={state.styleFilters}
      tagFilter={state.tagFilter}
      timeFilter={state.timeFilter}
    />
  );
  return [...markup.matchAll(/aria-label="(Remove [^"]*)"/g)].map(
    (match) => match[1] ?? ""
  );
};

const CHIP_KINDS: Record<string, Partial<CardsSearchState>> = {
  tag: { tagFilter: "design" },
  qualifier: { qualifierChips: ["site:github.com"] },
  keyword: { keywordTags: ["poster"] },
  time: {
    timeFilter: {
      kind: "relative",
      label: "Today",
      range: { end: 2, start: 1 },
    },
  },
  type: { filterTags: ["link"] },
  style: { styleFilters: ["vintage"] },
  hue: { hueFilters: ["purple"] },
  hex: { hexFilters: ["#663399"] },
};

const kinds = Object.keys(CHIP_KINDS);
const pairs = kinds.flatMap((left, index) =>
  kinds.slice(index + 1).map((right) => [left, right] as const)
);

describe("Backspace in an empty search box", () => {
  test.each(pairs)(
    "removes the chip shown last, with %s and %s chips",
    (left, right) => {
      const state: CardsSearchState = {
        ...createInitialCardsSearchState(),
        ...CHIP_KINDS[left],
        ...CHIP_KINDS[right],
      };
      const before = shownChips(state);
      expect(before).toHaveLength(2);

      expect(shownChips(applyBackspaceToCardsSearchState(state))).toEqual(
        before.slice(0, 1)
      );
    }
  );

  test("removes the last of several chips of one kind", () => {
    const state: CardsSearchState = {
      ...createInitialCardsSearchState(),
      keywordTags: ["poster", "bauhaus"],
    };
    expect(shownChips(applyBackspaceToCardsSearchState(state))).toEqual([
      "Remove poster",
    ]);
  });
});
