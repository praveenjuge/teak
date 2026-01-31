import { describe, expect, it } from "bun:test";
import {
  type Color,
  extractPaletteColors,
  getColorName,
  getContrastRatio,
  hexToRgb,
  parseColorString,
  parseColorsFromText,
} from "./colorUtils";

describe("hexToRgb", () => {
  it("should convert 6-digit hex to RGB", () => {
    const result = hexToRgb("#FF5733");
    expect(result).toEqual({ r: 255, g: 87, b: 51 });
  });

  it("should convert 6-digit hex without hash to RGB", () => {
    const result = hexToRgb("FF5733");
    expect(result).toEqual({ r: 255, g: 87, b: 51 });
  });

  it("should convert 3-digit hex to RGB", () => {
    const result = hexToRgb("#F53");
    expect(result).toEqual({ r: 255, g: 85, b: 51 });
  });

  it("should convert 3-digit hex without hash to RGB", () => {
    const result = hexToRgb("F53");
    expect(result).toEqual({ r: 255, g: 85, b: 51 });
  });

  it("should convert 4-digit hex (with alpha) to RGB", () => {
    const result = hexToRgb("#F53A");
    expect(result).toEqual({ r: 255, g: 85, b: 51 });
  });

  it("should convert 8-digit hex (with alpha) to RGB", () => {
    const result = hexToRgb("#FF5733AA");
    expect(result).toEqual({ r: 255, g: 87, b: 51 });
  });

  it("should handle lowercase hex", () => {
    const result = hexToRgb("#ff5733");
    expect(result).toEqual({ r: 255, g: 87, b: 51 });
  });

  it("should return null for invalid hex", () => {
    expect(hexToRgb("#GG5733")).toBeNull();
    // "FF57" has 4 chars, which gets doubled to "FFFF5577", then sliced to "FFFF55"
    expect(hexToRgb("FF57")).toEqual({ r: 255, g: 255, b: 85 });
    expect(hexToRgb("#FF57333")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });

  it("should convert white color", () => {
    const result = hexToRgb("#FFFFFF");
    expect(result).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("should convert black color", () => {
    const result = hexToRgb("#000000");
    expect(result).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("parseColorString", () => {
  describe("hex colors", () => {
    it("should parse 6-digit hex color", () => {
      const result = parseColorString("#FF5733");
      expect(result?.hex).toBe("#FF5733");
      expect(result?.rgb).toEqual({ r: 255, g: 87, b: 51 });
      expect(result?.hsl).toBeDefined();
    });

    it("should parse 3-digit hex color", () => {
      const result = parseColorString("#F53");
      expect(result?.hex).toBe("#FF5533");
      expect(result?.rgb).toEqual({ r: 255, g: 85, b: 51 });
    });

    it("should parse 8-digit hex color with alpha", () => {
      const result = parseColorString("#FF5733AA");
      expect(result?.hex).toBe("#FF5733AA");
    });

    it("should not parse hex without hash (requires # prefix)", () => {
      // parseColorString requires a leading # for hex colors
      const result = parseColorString("FF5733");
      expect(result).toBeNull();
    });

    it("should handle whitespace", () => {
      const result = parseColorString("  #FF5733  ");
      expect(result?.hex).toBe("#FF5733");
    });

    it("should return null for invalid hex", () => {
      expect(parseColorString("#GGGGGG")).toBeNull();
      expect(parseColorString("#FF")).toBeNull();
    });
  });

  describe("RGB colors", () => {
    it("should parse rgb() format", () => {
      const result = parseColorString("rgb(255, 87, 51)");
      expect(result?.hex).toBe("#FF5733");
      expect(result?.rgb).toEqual({ r: 255, g: 87, b: 51 });
    });

    it("should parse rgb with spaces", () => {
      const result = parseColorString("rgb( 255, 87 , 51 )");
      expect(result?.hex).toBe("#FF5733");
    });

    it("should parse rgba() format", () => {
      const result = parseColorString("rgba(255, 87, 51, 0.5)");
      expect(result?.hex).toBe("#FF5733");
    });

    it("should handle lowercase rgb", () => {
      const result = parseColorString("RGB(255,0,0)");
      expect(result?.hex).toBe("#FF0000");
    });

    it("should return null for out of range values", () => {
      expect(parseColorString("rgb(256, 0, 0)")).toBeNull();
      expect(parseColorString("rgb(-1, 0, 0)")).toBeNull();
    });

    it("should return null for invalid rgb", () => {
      expect(parseColorString("rgb(256, 0)")).toBeNull();
    });
  });

  describe("HSL colors", () => {
    it("should parse hsl() format", () => {
      const result = parseColorString("hsl(120, 100%, 50%)");
      expect(result?.rgb).toBeDefined();
      expect(result?.hsl).toEqual({ h: 120, s: 100, l: 50 });
    });

    it("should parse hsla() format", () => {
      const result = parseColorString("hsla(120, 100%, 50%, 0.5)");
      expect(result?.hsl).toEqual({ h: 120, s: 100, l: 50 });
    });

    it("should parse hsl with spaces", () => {
      const result = parseColorString("hsl( 120 , 100% , 50% )");
      expect(result?.hsl).toEqual({ h: 120, s: 100, l: 50 });
    });

    it("should return null for out of range hsl", () => {
      expect(parseColorString("hsl(361, 100%, 50%)")).toBeNull();
      expect(parseColorString("hsl(120, 101%, 50%)")).toBeNull();
      expect(parseColorString("hsl(120, 100%, 101%)")).toBeNull();
    });
  });

  describe("named colors", () => {
    it("should parse simple color names", () => {
      const result = parseColorString("red");
      expect(result?.hex).toBe("#FF0000");
      expect(result?.name).toBe("red");
    });

    it("should parse color names with spaces removed", () => {
      const result = parseColorString("light blue");
      expect(result?.hex).toBe("#ADD8E6");
      expect(result?.name).toBe("lightblue");
    });

    it("should parse multiple color names with special chars", () => {
      const result = parseColorString("light-blue");
      expect(result?.hex).toBe("#ADD8E6");
    });

    it("should parse dark gray", () => {
      const result = parseColorString("darkgray");
      expect(result?.hex).toBe("#A9A9A9");
    });

    it("should return null for unknown color name", () => {
      expect(parseColorString("notacolor")).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should return null for empty string", () => {
      expect(parseColorString("")).toBeNull();
    });

    it("should return null for whitespace only", () => {
      expect(parseColorString("   ")).toBeNull();
    });
  });
});

describe("parseColorsFromText", () => {
  it("should parse single hex color from text", () => {
    const result = parseColorsFromText("#FF5733");
    expect(result).toHaveLength(1);
    expect(result[0].hex).toBe("#FF5733");
  });

  it("should parse multiple colors separated by commas", () => {
    const result = parseColorsFromText("#FF5733, #00FF00, #0000FF");
    expect(result).toHaveLength(3);
    expect(result[0].hex).toBe("#FF5733");
    expect(result[1].hex).toBe("#00FF00");
    expect(result[2].hex).toBe("#0000FF");
  });

  it("should parse colors from newline-separated text", () => {
    const result = parseColorsFromText("#FF5733\n#00FF00\n#0000FF");
    expect(result).toHaveLength(3);
  });

  it("should deduplicate colors", () => {
    const result = parseColorsFromText("#FF5733, #FF5733, #ff5733");
    expect(result).toHaveLength(1);
    expect(result[0].hex).toBe("#FF5733");
  });

  it("should normalize hex to uppercase", () => {
    const result = parseColorsFromText("#ff5733");
    expect(result[0].hex).toBe("#FF5733");
  });

  it("should extract hex colors embedded in text", () => {
    const result = parseColorsFromText("The colors are #FF5733 and #00FF00");
    expect(result).toHaveLength(2);
  });

  it("should parse rgb colors from text", () => {
    const result = parseColorsFromText("rgb(255, 0, 0) and rgb(0, 255, 0)");
    expect(result).toHaveLength(2);
  });

  it("should parse hsl colors from text", () => {
    const result = parseColorsFromText("hsl(0, 100%, 50%)");
    expect(result).toHaveLength(1);
  });

  it("should parse mixed color formats", () => {
    const result = parseColorsFromText("#FF5733, rgb(0, 255, 0), red");
    expect(result).toHaveLength(3);
  });

  it("should handle semicolon separators", () => {
    const result = parseColorsFromText("#FF5733; #00FF00; #0000FF");
    expect(result).toHaveLength(3);
  });

  it("should skip empty parts", () => {
    const result = parseColorsFromText("#FF5733, , #00FF00");
    expect(result).toHaveLength(2);
  });

  it("should return empty array for text with no colors", () => {
    const result = parseColorsFromText("just regular text");
    expect(result).toHaveLength(0);
  });

  it("should handle 3-digit hex colors", () => {
    const result = parseColorsFromText("#F53 #0F0");
    expect(result).toHaveLength(2);
  });

  it("should extract colors from within sentences", () => {
    const result = parseColorsFromText("I like #F00 and #00F but not #0F0");
    expect(result).toHaveLength(3);
  });
});

describe("extractPaletteColors", () => {
  it("should extract colors from comma-separated list", () => {
    const result = extractPaletteColors("#FF5733, #00FF00, #0000FF");
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((c) => c.hex === "#FF5733")).toBe(true);
  });

  it("should respect maxColors parameter", () => {
    const result = extractPaletteColors("#FF5733, #00FF00, #0000FF", 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("should parse CSS custom properties with names", () => {
    const result = extractPaletteColors(
      "--primary: #FF5733; --secondary: #00FF00;"
    );
    expect(result.length).toBeGreaterThanOrEqual(2);
    const primary = result.find((c) => c.name === "Primary");
    expect(primary).toBeDefined();
  });

  it("should convert slug to palette name", () => {
    const result = extractPaletteColors("--bg-primary: #FF5733");
    // formatPaletteName capitalizes each word: "bg-primary" -> "Bg Primary"
    const bgPrimary = result.find((c) => c.name === "Bg Primary");
    expect(bgPrimary).toBeDefined();
  });

  it("should parse labeled color pairs", () => {
    const result = extractPaletteColors("Primary: #FF5733, Accent - #00FF00");
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("should parse Tailwind arbitrary values", () => {
    const result = extractPaletteColors("bg-[#FF5733] text-[#00FF00]");
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle escaped newlines", () => {
    const result = extractPaletteColors("#FF5733\\n#00FF00\\n#0000FF");
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it("should handle br tags as newlines", () => {
    const result = extractPaletteColors("#FF5733<br>#00FF00");
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle CSS color properties", () => {
    const result = extractPaletteColors(
      "color: #FF5733; background-color: #00FF00;"
    );
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("should deduplicate colors", () => {
    const result = extractPaletteColors("#FF5733, #FF5733, #ff5733");
    const duplicates = result.filter((c) => c.hex === "#FF5733");
    expect(duplicates.length).toBe(1);
  });

  it("should preserve inferred names from CSS variables", () => {
    const result = extractPaletteColors("--text-color: #333333");
    const color = result.find((c) => c.hex === "#333333");
    // formatPaletteName capitalizes each word
    expect(color?.name).toBe("Text Color");
  });

  it("should handle maxColors of 1", () => {
    const result = extractPaletteColors("#FF5733, #00FF00", 1);
    expect(result.length).toBe(1);
  });

  it("should handle larger maxColors", () => {
    const result = extractPaletteColors(
      "#FF5733, #00FF00, #0000FF, #FFFF00, #FF00FF",
      20
    );
    expect(result.length).toBeGreaterThanOrEqual(5);
  });
});

describe("getColorName", () => {
  it("should return name for known color", () => {
    expect(getColorName("#FF0000")).toBe("red");
    expect(getColorName("#00FF00")).toBe("lime");
    expect(getColorName("#0000FF")).toBe("blue");
  });

  it("should return undefined for unknown color", () => {
    expect(getColorName("#FF5733")).toBeUndefined();
  });

  it("should not handle hex without hash (COLOR_NAMES values have #)", () => {
    // COLOR_NAMES stores values with leading #, so input needs it too
    expect(getColorName("FF0000")).toBeUndefined();
    expect(getColorName("#FF0000")).toBe("red");
  });

  it("should handle lowercase input", () => {
    expect(getColorName("#ff0000")).toBe("red");
  });

  it("should handle mixed case input", () => {
    expect(getColorName("#Ff0000")).toBe("red");
  });

  it("should return name for white", () => {
    expect(getColorName("#FFFFFF")).toBe("white");
  });

  it("should return name for black", () => {
    expect(getColorName("#000000")).toBe("black");
  });

  it("should return name for gray variants", () => {
    expect(getColorName("#808080")).toBe("gray");
    expect(getColorName("#A9A9A9")).toBe("darkgray");
  });
});

describe("getContrastRatio", () => {
  it("should calculate contrast between black and white", () => {
    const black: Color = { hex: "#000000", rgb: { r: 0, g: 0, b: 0 } };
    const white: Color = { hex: "#FFFFFF", rgb: { r: 255, g: 255, b: 255 } };
    const ratio = getContrastRatio(black, white);
    expect(ratio).toBeCloseTo(21, 0);
  });

  it("should calculate contrast between white and black (same result)", () => {
    const black: Color = { hex: "#000000", rgb: { r: 0, g: 0, b: 0 } };
    const white: Color = { hex: "#FFFFFF", rgb: { r: 255, g: 255, b: 255 } };
    const ratio = getContrastRatio(white, black);
    expect(ratio).toBeCloseTo(21, 0);
  });

  it("should return 0 for colors without RGB", () => {
    const color1: Color = { hex: "#000000" };
    const color2: Color = { hex: "#FFFFFF" };
    expect(getContrastRatio(color1, color2)).toBe(0);
  });

  it("should calculate lower contrast for similar colors", () => {
    const color1: Color = {
      hex: "#FF0000",
      rgb: { r: 255, g: 0, b: 0 },
    };
    const color2: Color = {
      hex: "#CC0000",
      rgb: { r: 204, g: 0, b: 0 },
    };
    const ratio = getContrastRatio(color1, color2);
    expect(ratio).toBeLessThan(3);
  });

  it("should calculate contrast for dark gray and white", () => {
    const darkGray: Color = {
      hex: "#333333",
      rgb: { r: 51, g: 51, b: 51 },
    };
    const white: Color = {
      hex: "#FFFFFF",
      rgb: { r: 255, g: 255, b: 255 },
    };
    const ratio = getContrastRatio(darkGray, white);
    expect(ratio).toBeGreaterThan(10);
  });

  it("should be symmetric", () => {
    const color1: Color = {
      hex: "#123456",
      rgb: { r: 18, g: 52, b: 86 },
    };
    const color2: Color = {
      hex: "#ABCDEF",
      rgb: { r: 171, g: 205, b: 239 },
    };
    const ratio1 = getContrastRatio(color1, color2);
    const ratio2 = getContrastRatio(color2, color1);
    expect(ratio1).toBeCloseTo(ratio2, 5);
  });
});
