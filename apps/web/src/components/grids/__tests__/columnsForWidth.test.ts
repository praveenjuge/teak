import { describe, expect, test } from "bun:test";
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
