import { describe, expect, test } from "bun:test";
import { DEMO_COLUMNS, pickDemoColumns } from "./home-demo-cards";

const ids = (columns: { id: string }[][]) =>
  columns.map((column) => column.map((card) => card.id));

describe("pickDemoColumns", () => {
  test("deals the cards in the given order across the columns", () => {
    const columns = pickDemoColumns(
      ["rams", "harbor", "desk", "inter", "nng"],
      3
    );

    expect(ids(columns)).toEqual([
      ["rams", "inter"],
      ["harbor", "nng"],
      ["desk"],
    ]);
  });

  test("keeps every column within one card of the others", () => {
    const allIds = DEMO_COLUMNS.flat().map((card) => card.id);

    for (let count = 1; count <= allIds.length; count++) {
      const lengths = pickDemoColumns(allIds.slice(0, count)).map(
        (column) => column.length
      );

      expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(
        1
      );
      expect(lengths.reduce((sum, length) => sum + length, 0)).toBe(count);
    }
  });

  test("uses the homepage's column count by default", () => {
    const allIds = DEMO_COLUMNS.flat().map((card) => card.id);

    expect(pickDemoColumns(allIds)).toHaveLength(DEMO_COLUMNS.length);
  });

  test("never leaves an empty column when there are fewer cards than columns", () => {
    expect(ids(pickDemoColumns(["rams", "desk"]))).toEqual([
      ["rams"],
      ["desk"],
    ]);
  });

  test("returns the card data for each id", () => {
    const [[card]] = pickDemoColumns(["harbor"]);

    expect(card).toMatchObject({ id: "harbor", type: "palette" });
  });

  test("refuses an id that is not a demo card", () => {
    expect(() => pickDemoColumns(["rams", "no-such-card"])).toThrow(
      "Unknown demo card id: no-such-card"
    );
  });
});
