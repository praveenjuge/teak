// @ts-nocheck
import { describe, expect, it } from "bun:test";

import { extractPaletteColors, parseColorString, getContrastRatio, hexToRgb } from "../../../../../convex/shared/utils/colorUtils";

describe("colorUtils", () => {
  describe("hexToRgb", () => {
    it("handles 3-digit hex", () => {
      expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
    });

    it("handles 4-digit hex", () => {
      expect(hexToRgb("#abcd")).toEqual({ r: 170, g: 187, b: 204 });
    });

    it("handles 8-digit hex", () => {
      expect(hexToRgb("#11223344")).toEqual({ r: 17, g: 34, b: 51 });
    });

    it("returns null for invalid length", () => {
      expect(hexToRgb("#12345")).toBeNull();
    });

    it("returns null for non-hex chars", () => {
      expect(hexToRgb("qqqqqq")).toBeNull();
    });
  });

  describe("parseColorString", () => {
    it("parses 6-digit hex", () => {
      const c = parseColorString("#FF5733");
      expect(c?.hex).toBe("#FF5733");
      expect(c?.rgb).toEqual({ r: 255, g: 87, b: 51 });
    });

    it("parses 3-digit hex", () => {
      const c = parseColorString("#F53");
      expect(c?.hex).toBe("#FF5533");
    });

    it("parses 4-digit hex (alpha)", () => {
      const c = parseColorString("#F538");
      expect(c?.hex).toBe("#FF553388");
    });

    it("parses 8-digit hex (alpha)", () => {
      const c = parseColorString("#FF573380");
      expect(c?.hex).toBe("#FF573380");
    });

    it("parses rgb", () => {
      const c = parseColorString("rgb(255, 0, 128)");
      expect(c?.hex).toBe("#FF0080");
      expect(c?.rgb).toEqual({ r: 255, g: 0, b: 128 });
    });

    it("parses rgba", () => {
      const c = parseColorString("rgba(255, 0, 128, 0.5)");
      expect(c?.hex).toBe("#FF0080");
    });

    it("parses hsl", () => {
      const c = parseColorString("hsl(0, 100%, 50%)");
      expect(c?.hex).toBe("#FF0000");
      expect(c?.hsl).toEqual({ h: 0, s: 100, l: 50 });
    });

    it("parses hsla", () => {
      const c = parseColorString("hsla(120, 100%, 50%, 0.3)");
      expect(c?.hex).toBe("#00FF00");
    });

    it("parses named colors", () => {
      const c = parseColorString("blue");
      expect(c?.hex).toBe("#0000FF");
      expect(c?.name).toBe("blue");
    });

    it("returns null for invalid strings", () => {
      expect(parseColorString("invalid")).toBeNull();
      expect(parseColorString("#12")).toBeNull(); // too short
      expect(parseColorString("rgb(300, 0, 0)")).toBeNull(); // out of range
    });
    it("parses achromatic hsl", () => {
      const c = parseColorString("hsl(0, 0%, 50%)");
      expect(c?.hex).toBe("#808080");
      expect(c?.rgb).toEqual({ r: 128, g: 128, b: 128 });
    });

    it("rejects invalid rgb values", () => {
      expect(parseColorString("rgb(256, 0, 0)")).toBeNull();
      expect(parseColorString("rgb(0, -1, 0)")).toBeNull();
    });

    it("rejects invalid hsl values", () => {
      expect(parseColorString("hsl(361, 0%, 0%)")).toBeNull();
      expect(parseColorString("hsl(0, 101%, 0%)")).toBeNull();
    });
  });

  describe("extractPaletteColors", () => {
    it("deduplicates and preserves first-seen order", () => {
      const colors = extractPaletteColors("#112233, #445566, #112233");
      expect(colors.map((c) => c.hex)).toEqual(["#112233", "#445566"]);
    });

    it("captures labelled colours", () => {
      const colors = extractPaletteColors(
        "Primary: #0F4C81\nAccent - rgb(255, 0, 128)"
      );
      expect(colors[0]).toMatchObject({ hex: "#0F4C81", name: "Primary" });
      expect(colors[1]).toMatchObject({
        hex: "#FF0080",
        name: "Accent",
      });
    });

    it("handles CSS properties, variables, and Tailwind arbitrary values", () => {
      const input = `
        --brand-primary: #123456;
        color: #fff;
        bg-[#0fa];
        text-[rgba(10, 20, 30, 0.5)];
      `;
      const hexes = extractPaletteColors(input).map((c) => c.hex);
      expect(hexes).toContain("#123456");
      expect(hexes).toContain("#FFFFFF");
      expect(hexes).toContain("#00FFAA");
      expect(hexes).toContain("#0A141E");
    });

    it("enforces a maximum of 12 colours", () => {
      const input = Array.from({ length: 20 }, (_, i) => `#${(i + 1).toString(16).padStart(6, "0")}`).join(" ");
      const colors = extractPaletteColors(input);
      expect(colors).toHaveLength(12);
    });

    it("handles literal escaped newlines", () => {
      const input = "Primary: #0F4C81\\nAccent - rgb(255, 0, 128)";
      const colors = extractPaletteColors(input);
      expect(colors[0]).toMatchObject({ hex: "#0F4C81", name: "Primary" });
      expect(colors[1]).toMatchObject({ hex: "#FF0080", name: "Accent" });
    });

    it("parses single HSL colour", () => {
      const colors = extractPaletteColors("hsl(340, 100%, 50%)");
      expect(colors).toHaveLength(1);
      expect(colors[0].hex).toBe("#FF0055");
    });

    it("handles existing colors with new names", () => {
      const input = "Primary: #FFF\nSecondary: #FFFFFF"; // same hex
      const colors = extractPaletteColors(input);
      expect(colors).toHaveLength(1);
      expect(colors[0].name).toBe("Primary");
    });

    it("fills in name for existing unnamed color", () => {
      const input = "#FFF, Primary: #FFFFFF";
      const colors = extractPaletteColors(input);
      expect(colors).toHaveLength(1);
      expect(colors[0].name).toBe("Primary");
    });

    it("ignores empty slug names from delimiters", () => {
      const input = "--__: #123456";
      const colors = extractPaletteColors(input);
      expect(colors).toHaveLength(1);
      expect(colors[0].name).toBeUndefined(); // Name should be undefined because formatPaletteName returns undefined
    });
  });

  describe("getContrastRatio", () => {
    it("calculates ratio between black and white", () => {
      const black = { hex: "#000000", rgb: { r: 0, g: 0, b: 0 } } as any;
      const white = { hex: "#FFFFFF", rgb: { r: 255, g: 255, b: 255 } } as any;
      const ratio = getContrastRatio(black, white);
      expect(ratio).toBeCloseTo(21, 1);
    });

    it("calculates ratio between same colors", () => {
      const c = { hex: "#000000", rgb: { r: 0, g: 0, b: 0 } } as any;
      expect(getContrastRatio(c, c)).toBe(1);
    });

    it("handles missing rgb", () => {
      expect(getContrastRatio({} as any, {} as any)).toBe(0);
    });
  });
});