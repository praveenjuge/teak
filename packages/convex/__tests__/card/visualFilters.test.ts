import { describe, expect, test } from "bun:test";
import { normalizeVisualFilterArgs } from "../../card/visualFilters";
import { SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION } from "../../shared/search/constants";

describe("card/visualFilters normalizeVisualFilterArgs", () => {
  test("caps hex filters to the per-dimension maximum", () => {
    // Build more unique valid hex values than the cap allows.
    const manyHexes = Array.from(
      { length: SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION + 50 },
      (_, i) => `#${i.toString(16).padStart(6, "0")}`
    );

    const result = normalizeVisualFilterArgs({ hexFilters: manyHexes });

    expect(result.hexFilters?.length).toBe(
      SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION
    );
    expect(result.hasVisualFilters).toBe(true);
  });

  test("still throws on invalid hex values before capping", () => {
    expect(() =>
      normalizeVisualFilterArgs({ hexFilters: ["not-a-hex"] })
    ).toThrow("Invalid hexFilters");
  });

  test("leaves small filter sets unchanged", () => {
    const result = normalizeVisualFilterArgs({
      hexFilters: ["#112233", "#445566"],
      hueFilters: ["blue"],
    });

    expect(result.hexFilters).toEqual(["#112233", "#445566"]);
    expect(result.hueFilters).toEqual(["blue"]);
  });

  test("reports no visual filters when nothing provided", () => {
    const result = normalizeVisualFilterArgs({});
    expect(result.hasVisualFilters).toBe(false);
    expect(result.hexFilters).toBeUndefined();
    expect(result.hueFilters).toBeUndefined();
    expect(result.styleFilters).toBeUndefined();
  });
});
