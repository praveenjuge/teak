import { describe, expect, test } from "bun:test";
import {
  editPaletteColors,
  paletteEditing,
  paletteHasColor,
} from "../paletteColors";

const hexes = (...values: string[]) => values.map((hex) => ({ hex }));

describe("editPaletteColors", () => {
  test("adds a new color at the end", () => {
    expect(editPaletteColors(hexes("#FF6B6B"), "addColor", "#4ECDC4")).toEqual(
      hexes("#FF6B6B", "#4ECDC4")
    );
  });

  test("skips a color the palette has in another spelling", () => {
    const colors = hexes("#ff6b6b");
    expect(editPaletteColors(colors, "addColor", "#FF6B6B")).toBe(colors);
  });

  test("adds back a color with alpha, which counts as its RGB", () => {
    expect(
      editPaletteColors(hexes("#00FF00"), "addColor", "#FF000080")
    ).toEqual(hexes("#00FF00", "#FF000080"));
    const withRed = hexes("#FF0000");
    expect(editPaletteColors(withRed, "addColor", "#FF000080")).toBe(withRed);
  });

  test("removes every copy of a color", () => {
    expect(
      editPaletteColors(
        hexes("#FFA06B", "#ffa06b", "#000000"),
        "removeColor",
        "#FFA06B"
      )
    ).toEqual(hexes("#000000"));
  });
});

describe("paletteEditing", () => {
  const twelve = hexes(
    ...Array.from(
      { length: 12 },
      (_, i) => `#0000${i.toString(16).padStart(2, "0")}`
    )
  );

  test.each([
    [
      "two colors",
      { type: "palette", colors: hexes("#FF0000", "#00FF00") },
      true,
      true,
    ],
    ["one color", { type: "palette", colors: hexes("#FF0000") }, true, false],
    [
      "one color twice",
      { type: "palette", colors: hexes("#FF0000", "#ff0000") },
      true,
      false,
    ],
    ["twelve colors", { type: "palette", colors: twelve }, false, true],
    [
      "a palette in Trash",
      { type: "palette", colors: hexes("#FF0000", "#00FF00"), isDeleted: true },
      false,
      false,
    ],
    [
      "an image",
      { type: "image", colors: hexes("#FF0000", "#00FF00") },
      false,
      false,
    ],
  ] as const)("%s", (_, card, canAdd, canRemove) => {
    const canEdit = card.type === "palette" && !("isDeleted" in card);
    expect(
      paletteEditing(card as Parameters<typeof paletteEditing>[0])
    ).toEqual({
      canAdd,
      canEdit,
      canRemove,
    });
  });
});

test("paletteHasColor compares normalized hex codes", () => {
  expect(paletteHasColor(hexes("#ff5500"), "#FF5500")).toBe(true);
  expect(paletteHasColor(hexes("#ff5500"), "#FF5501")).toBe(false);
  expect(paletteHasColor(undefined, "#FF5500")).toBe(false);
});
