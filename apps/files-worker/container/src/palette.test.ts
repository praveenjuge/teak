import { describe, expect, test } from "bun:test";
import { extractPalette } from "./palette";

type Rgba = [number, number, number, number];

/** RGBA bytes with `count` pixels of each color, in order. */
const image = (...runs: [Rgba, number][]): Uint8Array => {
  const bytes: number[] = [];
  for (const [color, count] of runs) {
    for (let index = 0; index < count; index += 1) {
      bytes.push(...color);
    }
  }
  return new Uint8Array(bytes);
};

const opaque = (hex: string): Rgba => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
  255,
];

describe("extractPalette", () => {
  test("ranks colors by how much of the image they cover", () => {
    const palette = extractPalette(
      image([opaque("#1E40AF"), 100], [opaque("#F59E0B"), 300])
    );
    expect(palette.map((swatch) => swatch.hex)).toEqual(["#F59E0B", "#1E40AF"]);
    expect(palette[0]?.weight).toBeCloseTo(0.75);
    expect(palette[1]?.weight).toBeCloseTo(0.25);
  });

  test("merges shades too close to tell apart into one swatch", () => {
    const whites = ["#FFFFFF", "#FBFBFB", "#F6F6F6", "#F2F2F2", "#EEEEEE"];
    const palette = extractPalette(
      image(...whites.map((hex): [Rgba, number] => [opaque(hex), 60]), [
        opaque("#2563EB"),
        100,
      ])
    );
    expect(palette).toHaveLength(2);
    expect(palette[0]?.weight).toBeCloseTo(0.75);
    expect(palette[1]?.hex).toBe("#2563EB");
  });

  test("keeps a small vivid accent that a size ranking would drop", () => {
    const palette = extractPalette(
      image(
        [opaque("#FFFFFF"), 300],
        [opaque("#000000"), 250],
        [opaque("#808080"), 200],
        [opaque("#1F2A44"), 130],
        [opaque("#C8B496"), 105],
        [opaque("#E02020"), 15]
      )
    );
    expect(palette.map((swatch) => swatch.hex)).toEqual([
      "#FFFFFF",
      "#000000",
      "#808080",
      "#1F2A44",
      "#E02020",
    ]);
  });

  test("prefers a distinct color over another shade of one already picked", () => {
    const palette = extractPalette(
      image(
        [opaque("#C9B6A1"), 204],
        [opaque("#A09589"), 181],
        [opaque("#645F5B"), 123],
        [opaque("#48423E"), 112],
        [opaque("#857669"), 111],
        [opaque("#0D0B09"), 93],
        [opaque("#2B2723"), 89],
        [opaque("#DCE2EA"), 76]
      )
    );
    const hexes = palette.map((swatch) => swatch.hex);
    // Near-black covers less than the mid brown between two picked shades,
    // but nothing picked is close to it.
    expect(hexes).toContain("#0D0B09");
    expect(hexes).not.toContain("#857669");
    expect(palette.map((swatch) => swatch.weight)).toEqual(
      [...palette.map((swatch) => swatch.weight)].sort((a, b) => b - a)
    );
  });

  test("ignores pixels under half opacity", () => {
    const palette = extractPalette(
      image(
        [[220, 38, 38, 0], 300],
        [[220, 38, 38, 90], 300],
        [opaque("#16A34A"), 50]
      )
    );
    expect(palette).toEqual([{ hex: "#16A34A", weight: 1 }]);
  });

  test("has no colors for a fully transparent or empty image", () => {
    expect(extractPalette(image([[255, 0, 0, 0], 64]))).toEqual([]);
    expect(extractPalette(new Uint8Array())).toEqual([]);
  });

  test("returns at most the requested number of colors", () => {
    const hexes = [
      "#EF4444",
      "#22C55E",
      "#3B82F6",
      "#EAB308",
      "#A855F7",
      "#000000",
    ];
    const palette = extractPalette(
      image(...hexes.map((hex): [Rgba, number] => [opaque(hex), 50])),
      3
    );
    expect(palette).toHaveLength(3);
  });
});
