import { describe, expect, test } from "bun:test";
import { columnsForWidth } from "../gridColumns";

describe("columnsForWidth", () => {
  test.each([
    [167, 1],
    [358, 2],
    [552, 3],
    [736, 4],
    [920, 5],
    [1360, 5],
  ])("fits %ipx into %i columns", (width, columns) => {
    expect(columnsForWidth(width)).toBe(columns);
  });

  test("never goes below one or above five columns", () => {
    expect(columnsForWidth(0)).toBe(1);
    expect(columnsForWidth(4000)).toBe(5);
  });
});
