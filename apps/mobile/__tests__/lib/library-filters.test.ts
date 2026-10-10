import { describe, expect, test } from "bun:test";
import {
  EMPTY_FILTERS,
  filtersTitle,
  hasActiveFilters,
  toggleType,
  toSearchArgs,
} from "../../lib/library-filters";

describe("home filters", () => {
  test("send only the filters that are on to the search query", () => {
    expect(toSearchArgs(EMPTY_FILTERS)).toEqual({
      favoritesOnly: undefined,
      hueFilters: undefined,
      showTrashOnly: undefined,
      types: undefined,
    });
    expect(
      toSearchArgs({
        favoritesOnly: true,
        hue: "blue",
        trashOnly: true,
        types: ["image", "link"],
      })
    ).toEqual({
      favoritesOnly: true,
      hueFilters: ["blue"],
      showTrashOnly: true,
      types: ["image", "link"],
    });
  });

  test("toggling a type adds it, then removes it", () => {
    const withImages = toggleType(EMPTY_FILTERS, "image");
    expect(withImages.types).toEqual(["image"]);
    expect(hasActiveFilters(withImages)).toBe(true);
    expect(toggleType(withImages, "image").types).toEqual([]);
    expect(hasActiveFilters(toggleType(withImages, "image"))).toBe(false);
  });

  test.each([
    [EMPTY_FILTERS, "Home"],
    [{ ...EMPTY_FILTERS, trashOnly: true, favoritesOnly: true }, "Trash"],
    [{ ...EMPTY_FILTERS, favoritesOnly: true }, "Favorites"],
    [{ ...EMPTY_FILTERS, types: ["text" as const] }, "Notes"],
    [
      { ...EMPTY_FILTERS, favoritesOnly: true, types: ["link" as const] },
      "Favorite Links",
    ],
    [{ ...EMPTY_FILTERS, hue: "teal" as const }, "Teal"],
  ])("titles %o as %s", (filters, title) => {
    expect(filtersTitle(filters)).toBe(title);
  });
});
