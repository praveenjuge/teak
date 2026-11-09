import { describe, expect, test } from "bun:test";
import type { Doc } from "../../../_generated/dataModel";
import { matchesVisualFilters } from "../../../shared/search/visualFilters";

const card = (
  fields: Partial<
    Pick<Doc<"cards">, "colorHexes" | "colorHues" | "type" | "visualStyles">
  >
) => ({ type: "image" as const, ...fields });

describe("matchesVisualFilters", () => {
  test("no filters match every card", () => {
    expect(matchesVisualFilters(card({ type: "text" }), {})).toBe(true);
  });

  test.each([
    ["a style the card has", card({ visualStyles: ["minimal"] }), true],
    ["no style the card has", card({ visualStyles: ["vintage"] }), false],
    [
      "a style on a card type without styles",
      card({ type: "text", visualStyles: ["minimal"] }),
      false,
    ],
  ])("a style filter keeps %s: %p", (_label, styled, expected) => {
    expect(
      matchesVisualFilters(styled, { styleFilters: ["minimal", "bold"] })
    ).toBe(expected);
  });

  test("hue and hex filters only match color cards holding one of them", () => {
    const palette = card({
      type: "palette",
      colorHues: ["blue"],
      colorHexes: ["#112233"],
    });
    expect(matchesVisualFilters(palette, { hueFilters: ["blue"] })).toBe(true);
    expect(matchesVisualFilters(palette, { hexFilters: ["#112233"] })).toBe(
      true
    );
    expect(matchesVisualFilters(palette, { hexFilters: ["#445566"] })).toBe(
      false
    );
    expect(
      matchesVisualFilters(card({ type: "link", colorHues: ["blue"] }), {
        hueFilters: ["blue"],
      })
    ).toBe(false);
  });

  test("every filter given must match", () => {
    const palette = card({ type: "palette", colorHues: ["blue"] });
    expect(
      matchesVisualFilters(palette, {
        hueFilters: ["blue"],
        hexFilters: ["#112233"],
      })
    ).toBe(false);
  });
});
