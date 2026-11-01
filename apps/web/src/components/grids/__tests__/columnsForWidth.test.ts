import { describe, expect, test } from "bun:test";
import { CARD_GRID_LAYOUTS } from "../../../lib/cardDensity";
import { columnsForWidth } from "../MasonryGrid";

describe("columnsForWidth", () => {
  test.each([
    [358, 1],
    [480, 2],
    [736, 3],
    [944, 4],
    [1152, 5],
    [1248, 5],
  ])("fits %ipx into %i columns", (width, columns) => {
    expect(columnsForWidth(width, 24)).toBe(columns);
  });

  test("never goes below one or above five columns", () => {
    expect(columnsForWidth(0, 24)).toBe(1);
    expect(columnsForWidth(4000, 24)).toBe(5);
  });
});

describe("the compact density", () => {
  test("fits more, narrower columns into the same width", () => {
    const { gutter, maxColumns, minColumnWidth } = CARD_GRID_LAYOUTS.compact;
    const comfortable = CARD_GRID_LAYOUTS.comfortable;
    expect(
      columnsForWidth(
        1248,
        comfortable.gutter,
        comfortable.minColumnWidth,
        comfortable.maxColumns
      )
    ).toBe(5);
    expect(columnsForWidth(1248, gutter, minColumnWidth, maxColumns)).toBe(7);
    expect(columnsForWidth(358, gutter, minColumnWidth, maxColumns)).toBe(2);
    expect(columnsForWidth(4000, gutter, minColumnWidth, maxColumns)).toBe(7);
  });
});
