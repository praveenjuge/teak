// Color utility functions for parsing and working with colors
import type { ColorHueBucket } from "../constants";

export interface Color {
  hex: string;
  name?: string;
  rgb?: {
    r: number;
    g: number;
    b: number;
  };
  hsl?: {
    h: number;
    s: number;
    l: number;
  };
}

// CSS color names mapping
const COLOR_NAMES: Record<string, string> = {
  aliceblue: "#F0F8FF",
  antiquewhite: "#FAEBD7",
  aqua: "#00FFFF",
  aquamarine: "#7FFFD4",
  azure: "#F0FFFF",
  beige: "#F5F5DC",
  bisque: "#FFE4C4",
  black: "#000000",
  blanchedalmond: "#FFEBCD",
  blue: "#0000FF",
  blueviolet: "#8A2BE2",
  brown: "#A52A2A",
  burlywood: "#DEB887",
  cadetblue: "#5F9EA0",
  chartreuse: "#7FFF00",
  chocolate: "#D2691E",
  coral: "#FF7F50",
  cornflowerblue: "#6495ED",
  cornsilk: "#FFF8DC",
  crimson: "#DC143C",
  cyan: "#00FFFF",
  darkblue: "#00008B",
  darkcyan: "#008B8B",
  darkgoldenrod: "#B8860B",
  darkgray: "#A9A9A9",
  darkgrey: "#A9A9A9",
  darkgreen: "#006400",
  darkkhaki: "#BDB76B",
  darkmagenta: "#8B008B",
  darkolivegreen: "#556B2F",
  darkorange: "#FF8C00",
  darkorchid: "#9932CC",
  darkred: "#8B0000",
  darksalmon: "#E9967A",
  darkseagreen: "#8FBC8F",
  darkslateblue: "#483D8B",
  darkslategray: "#2F4F4F",
  darkslategrey: "#2F4F4F",
  darkturquoise: "#00CED1",
  darkviolet: "#9400D3",
  deeppink: "#FF1493",
  deepskyblue: "#00BFFF",
  dimgray: "#696969",
  dimgrey: "#696969",
  dodgerblue: "#1E90FF",
  firebrick: "#B22222",
  floralwhite: "#FFFAF0",
  forestgreen: "#228B22",
  fuchsia: "#FF00FF",
  gainsboro: "#DCDCDC",
  ghostwhite: "#F8F8FF",
  gold: "#FFD700",
  goldenrod: "#DAA520",
  gray: "#808080",
  grey: "#808080",
  green: "#008000",
  greenyellow: "#ADFF2F",
  honeydew: "#F0FFF0",
  hotpink: "#FF69B4",
  indianred: "#CD5C5C",
  indigo: "#4B0082",
  ivory: "#FFFFF0",
  khaki: "#F0E68C",
  lavender: "#E6E6FA",
  lavenderblush: "#FFF0F5",
  lawngreen: "#7CFC00",
  lemonchiffon: "#FFFACD",
  lightblue: "#ADD8E6",
  lightcoral: "#F08080",
  lightcyan: "#E0FFFF",
  lightgoldenrodyellow: "#FAFAD2",
  lightgray: "#D3D3D3",
  lightgrey: "#D3D3D3",
  lightgreen: "#90EE90",
  lightpink: "#FFB6C1",
  lightsalmon: "#FFA07A",
  lightseagreen: "#20B2AA",
  lightskyblue: "#87CEFA",
  lightslategray: "#778899",
  lightslategrey: "#778899",
  lightsteelblue: "#B0C4DE",
  lightyellow: "#FFFFE0",
  lime: "#00FF00",
  limegreen: "#32CD32",
  linen: "#FAF0E6",
  magenta: "#FF00FF",
  maroon: "#800000",
  mediumaquamarine: "#66CDAA",
  mediumblue: "#0000CD",
  mediumorchid: "#BA55D3",
  mediumpurple: "#9370DB",
  mediumseagreen: "#3CB371",
  mediumslateblue: "#7B68EE",
  mediumspringgreen: "#00FA9A",
  mediumturquoise: "#48D1CC",
  mediumvioletred: "#C71585",
  midnightblue: "#191970",
  mintcream: "#F5FFFA",
  mistyrose: "#FFE4E1",
  moccasin: "#FFE4B5",
  navajowhite: "#FFDEAD",
  navy: "#000080",
  oldlace: "#FDF5E6",
  olive: "#808000",
  olivedrab: "#6B8E23",
  orange: "#FFA500",
  orangered: "#FF4500",
  orchid: "#DA70D6",
  palegoldenrod: "#EEE8AA",
  palegreen: "#98FB98",
  paleturquoise: "#AFEEEE",
  palevioletred: "#DB7093",
  papayawhip: "#FFEFD5",
  peachpuff: "#FFDAB9",
  peru: "#CD853F",
  pink: "#FFC0CB",
  plum: "#DDA0DD",
  powderblue: "#B0E0E6",
  purple: "#800080",
  red: "#FF0000",
  rosybrown: "#BC8F8F",
  royalblue: "#4169E1",
  saddlebrown: "#8B4513",
  salmon: "#FA8072",
  sandybrown: "#F4A460",
  seagreen: "#2E8B57",
  seashell: "#FFF5EE",
  sienna: "#A0522D",
  silver: "#C0C0C0",
  skyblue: "#87CEEB",
  slateblue: "#6A5ACD",
  slategray: "#708090",
  slategrey: "#708090",
  snow: "#FFFAFA",
  springgreen: "#00FF7F",
  steelblue: "#4682B4",
  tan: "#D2B48C",
  teal: "#008080",
  thistle: "#D8BFD8",
  tomato: "#FF6347",
  turquoise: "#40E0D0",
  violet: "#EE82EE",
  wheat: "#F5DEB3",
  white: "#FFFFFF",
  whitesmoke: "#F5F5F5",
  yellow: "#FFFF00",
  yellowgreen: "#9ACD32",
};

// Convert hex to RGB
export function hexToRgb(
  hex: string
): { r: number; g: number; b: number } | null {
  let normalized = hex.replace(/^#/, "");

  if (normalized.length === 3 || normalized.length === 4) {
    normalized = normalized
      .split("")
      .map((char) => char + char)
      .join("");
  }

  if (normalized.length === 8) {
    normalized = normalized.slice(0, 6);
  }

  if (normalized.length !== 6) {
    return null;
  }

  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
  return result
    ? {
        r: Number.parseInt(result[1], 16),
        g: Number.parseInt(result[2], 16),
        b: Number.parseInt(result[3], 16),
      }
    : null;
}

// Convert RGB to HSL
function rgbToHsl(
  red: number,
  green: number,
  blue: number
): { h: number; s: number; l: number } {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
      default:
        // max should always be r, g, or b
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

// Convert HSL to RGB
function hslToRgb(
  h: number,
  s: number,
  l: number
): { r: number; g: number; b: number } {
  const hNorm = h / 360;
  const sNorm = s / 100;
  const lNorm = l / 100;

  const hue2rgb = (p: number, q: number, t: number): number => {
    let tNorm = t;
    if (tNorm < 0) tNorm += 1;
    if (tNorm > 1) tNorm -= 1;
    if (tNorm < 1 / 6) return p + (q - p) * 6 * tNorm;
    if (tNorm < 1 / 2) return q;
    if (tNorm < 2 / 3) return p + (q - p) * (2 / 3 - tNorm) * 6;
    return p;
  };

  let red: number, green: number, blue: number;

  if (sNorm === 0) {
    red = green = blue = lNorm; // achromatic
  } else {
    const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
    const p = 2 * lNorm - q;
    red = hue2rgb(p, q, hNorm + 1 / 3);
    green = hue2rgb(p, q, hNorm);
    blue = hue2rgb(p, q, hNorm - 1 / 3);
  }

  return {
    r: Math.round(red * 255),
    g: Math.round(green * 255),
    b: Math.round(blue * 255),
  };
}

// Convert RGB to hex
function rgbToHex(red: number, green: number, blue: number): string {
  return `#${((1 << 24) + (red << 16) + (green << 8) + blue).toString(16).slice(1).toUpperCase()}`;
}

function toCanonicalHue(hue: number): number {
  const normalized = hue % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function classifyHueBucket(h: number, s: number, l: number): ColorHueBucket {
  if (s <= 12 || (l <= 12 && s <= 30) || (l >= 95 && s <= 10)) {
    return "neutral";
  }

  if (h >= 10 && h < 45 && s >= 20 && l < 45) {
    return "brown";
  }

  if (h < 15 || h >= 345) return "red";
  if (h < 45) return "orange";
  if (h < 70) return "yellow";
  if (h < 150) return "green";
  if (h < 180) return "teal";
  if (h < 205) return "cyan";
  if (h < 250) return "blue";
  if (h < 290) return "purple";
  if (h < 345) return "pink";
  return "red";
}

const toColorWithComputedHsl = (color: Color): Color | null => {
  if (color.hsl) {
    return color;
  }

  if (color.rgb) {
    return {
      ...color,
      hsl: rgbToHsl(color.rgb.r, color.rgb.g, color.rgb.b),
    };
  }

  const rgb = hexToRgb(color.hex);
  if (!rgb) {
    return null;
  }

  return {
    ...color,
    rgb,
    hsl: rgbToHsl(rgb.r, rgb.g, rgb.b),
  };
};

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const parsed = parseColorString(withHash);
  if (!parsed) {
    return null;
  }

  return parsed.hex.slice(0, 7).toUpperCase();
}

export function classifyHueForHex(hex: string): ColorHueBucket | null {
  const normalizedHex = normalizeHexColor(hex);
  if (!normalizedHex) {
    return null;
  }

  const parsed = parseColorString(normalizedHex);
  if (!parsed) {
    return null;
  }

  const withHsl = toColorWithComputedHsl(parsed);
  if (!withHsl?.hsl) {
    return null;
  }

  return classifyHueBucket(
    toCanonicalHue(withHsl.hsl.h),
    withHsl.hsl.s,
    withHsl.hsl.l
  );
}

export function normalizeHexFilters(values?: string[]): {
  normalized: string[];
  invalid: string[];
} {
  if (!values?.length) {
    return { normalized: [], invalid: [] };
  }

  const normalized: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const hex = normalizeHexColor(value);
    if (!hex) {
      invalid.push(value);
      continue;
    }
    if (seen.has(hex)) {
      continue;
    }
    seen.add(hex);
    normalized.push(hex);
  }

  return { normalized, invalid };
}

export function buildColorFacets(colors?: Color[]): {
  colorHexes?: string[];
  colorHues?: ColorHueBucket[];
} {
  if (!colors?.length) {
    return {};
  }

  const hexes: string[] = [];
  const hues: ColorHueBucket[] = [];
  const seenHexes = new Set<string>();
  const seenHues = new Set<ColorHueBucket>();

  for (const color of colors) {
    const normalizedHex = normalizeHexColor(color.hex);
    if (!normalizedHex) {
      continue;
    }

    if (!seenHexes.has(normalizedHex)) {
      seenHexes.add(normalizedHex);
      hexes.push(normalizedHex);
    }

    const hue = classifyHueForHex(normalizedHex);
    if (hue && !seenHues.has(hue)) {
      seenHues.add(hue);
      hues.push(hue);
    }
  }

  return {
    colorHexes: hexes.length > 0 ? hexes : undefined,
    colorHues: hues.length > 0 ? hues : undefined,
  };
}

export type PaletteCopyFormat =
  | "comma-separated"
  | "newline-separated"
  | "css-variables";

const toCssVariableName = (color: Color, index: number): string => {
  // Limit input length to prevent ReDoS attacks
  const name = color.name?.trim().toLowerCase().slice(0, 100) || "";
  const base =
    name.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
    `color-${index + 1}`;
  return base;
};

export function formatPaletteForCopy(
  colors: Color[],
  format: PaletteCopyFormat
): string {
  if (!colors.length) {
    return "";
  }

  const deduped: Color[] = [];
  const seen = new Set<string>();

  for (const color of colors) {
    const hex = normalizeHexColor(color.hex);
    if (!hex || seen.has(hex)) {
      continue;
    }
    seen.add(hex);
    deduped.push({ ...color, hex });
  }

  if (!deduped.length) {
    return "";
  }

  if (format === "comma-separated") {
    return deduped.map((color) => color.hex).join(", ");
  }

  if (format === "newline-separated") {
    return deduped.map((color) => color.hex).join("\n");
  }

  const cssLines = deduped.map(
    (color, index) => `  --${toCssVariableName(color, index)}: ${color.hex};`
  );
  return [":root {", ...cssLines, "}"].join("\n");
}

// Parse a single color from text
export function parseColorString(colorText: string): Color | null {
  const text = colorText.trim().toLowerCase();

  // Try hex format (#FF5733, #f53, #abcd, #97f9f9ff)
  const hexMatch = text.match(/^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i);
  if (hexMatch) {
    let raw = hexMatch[1];
    if (raw.length === 3 || raw.length === 4) {
      raw = raw
        .split("")
        .map((char) => char + char)
        .join("");
    }

    const rgbHex = raw.slice(0, 6);
    const alpha = raw.length === 8 ? raw.slice(6) : undefined;
    const rgb = hexToRgb(rgbHex);
    const hsl = rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : undefined;
    const baseHex = `#${rgbHex.toUpperCase()}`;
    const hex = alpha ? `#${(rgbHex + alpha).toUpperCase()}` : baseHex;
    const name = alpha ? undefined : getColorName(baseHex);

    return {
      hex,
      ...(name ? { name } : {}),
      rgb: rgb || undefined,
      hsl,
    };
  }

  // Try RGB format
  const rgbMatch = text.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)/
  );
  if (rgbMatch) {
    const red = Number.parseInt(rgbMatch[1], 10);
    const green = Number.parseInt(rgbMatch[2], 10);
    const blue = Number.parseInt(rgbMatch[3], 10);

    if (
      red >= 0 &&
      red <= 255 &&
      green >= 0 &&
      green <= 255 &&
      blue >= 0 &&
      blue <= 255
    ) {
      const hex = rgbToHex(red, green, blue);
      const hsl = rgbToHsl(red, green, blue);

      return {
        hex,
        rgb: { r: red, g: green, b: blue },
        hsl,
      };
    }
  }

  // Try HSL format
  const hslMatch = text.match(
    /hsla?\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*(?:,\s*[\d.]+\s*)?\)/
  );
  if (hslMatch) {
    const h = Number.parseInt(hslMatch[1], 10);
    const s = Number.parseInt(hslMatch[2], 10);
    const l = Number.parseInt(hslMatch[3], 10);

    if (h >= 0 && h <= 360 && s >= 0 && s <= 100 && l >= 0 && l <= 100) {
      const rgb = hslToRgb(h, s, l);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);

      return {
        hex,
        rgb,
        hsl: { h, s, l },
      };
    }
  }

  // Try color name
  const colorName = text.replace(/[^a-z]/g, "");
  if (COLOR_NAMES[colorName]) {
    const hex = COLOR_NAMES[colorName];
    const rgb = hexToRgb(hex);
    const hsl = rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : undefined;

    return {
      hex,
      name: colorName,
      rgb: rgb || undefined,
      hsl,
    };
  }

  return null;
}

// Parse multiple colors from text input
export function parseColorsFromText(text: string): Color[] {
  const colors: Color[] = [];
  const seenHex = new Set<string>();

  // Split by common delimiters, newlines, and spaces
  const parts = text.split(/[,;\n\r\t\s]+/);

  for (const part of parts) {
    const trimmedPart = part.trim();
    if (!trimmedPart) continue;

    const color = parseColorString(trimmedPart);
    if (color) {
      const normalizedHex = color.hex.toUpperCase();
      if (!seenHex.has(normalizedHex)) {
        colors.push({ ...color, hex: normalizedHex });
        seenHex.add(normalizedHex);
      }
    }
  }

  // Also try to extract colors from within longer text
  const allMatches = [
    ...text.matchAll(/#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})\b/gi),
    ...text.matchAll(
      /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/gi
    ),
    ...text.matchAll(
      /hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(?:,\s*[\d.]+\s*)?\)/gi
    ),
  ];

  for (const match of allMatches) {
    const color = parseColorString(match[0]);
    if (color) {
      const normalizedHex = color.hex.toUpperCase();
      if (!seenHex.has(normalizedHex)) {
        colors.push({ ...color, hex: normalizedHex });
        seenHex.add(normalizedHex);
      }
    }
  }

  return colors;
}

function formatPaletteName(slug: string): string | undefined {
  const cleaned = slug.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function extractPaletteColors(text: string, maxColors = 12): Color[] {
  // Normalize common escaped delimiters to better handle pasted strings containing literal "\n" etc.
  const normalizedText = text
    .replace(/\\n/gi, "\n")
    .replace(/\\r/gi, "\n")
    .replace(/\\t/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n");

  const limit = Math.max(1, maxColors);
  const result = new Map<string, Color>();

  const addColor = (color: Color | null, inferredName?: string) => {
    if (!color || result.size >= limit) return;
    const normalizedHex = color.hex.toUpperCase();
    const existing = result.get(normalizedHex);
    const name = inferredName?.trim() || color.name;

    if (existing) {
      if (!existing.name && name) {
        result.set(normalizedHex, { ...existing, name });
      }
      return;
    }

    result.set(normalizedHex, {
      ...color,
      hex: normalizedHex,
      ...(name ? { name } : {}),
    });
  };

  // CSS custom properties: infer name from the variable slug
  for (const match of normalizedText.matchAll(
    /--([a-z0-9_-]+)\s*:\s*([^;{}\n]+)[;}]?/gi
  )) {
    const [, slug, value] = match;
    const parsed = parseColorString(value.trim());
    addColor(parsed, formatPaletteName(slug));
  }

  // Labeled pairs like "Primary: #0F4C81" or "Accent - rgb(255, 0, 128)"
  for (const match of normalizedText.matchAll(
    /\b([A-Za-z][\w\s-]{0,32}?)\s*[:\-–]\s*(#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})\b|rgba?\([^)]*\)|hsla?\([^)]*\))/gi
  )) {
    const [, label, value] = match;
    const parsed = parseColorString(value.trim());
    addColor(parsed, label);
  }

  // CSS property declarations (color, background-color, border-color, fill, stroke, etc.)
  for (const match of normalizedText.matchAll(
    /\b(?:color|background-color|border-color|fill|stroke|outline-color)\s*:\s*([^;{}\n]+)/gi
  )) {
    const [, value] = match;
    const parsed = parseColorString(value.trim().split(/\s+/)[0]);
    addColor(parsed);
  }

  // Tailwind arbitrary values like bg-[#0fa] or text-[rgba(0,0,0,0.5)]
  for (const match of normalizedText.matchAll(
    /\[\s*(#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})|rgba?\([^)]*\)|hsla?\([^)]*\))\s*\]/gi
  )) {
    const [, value] = match;
    const parsed = parseColorString(value.trim());
    addColor(parsed);
  }

  // General free-form parsing + inline hex/rgb/hsl matches
  for (const color of parseColorsFromText(normalizedText)) {
    addColor(color, color.name);
  }

  return Array.from(result.values()).slice(0, limit);
}

// Get color name from hex if it matches a known color
export function getColorName(hex: string): string | undefined {
  const normalizedHex = hex.toUpperCase();
  for (const [name, value] of Object.entries(COLOR_NAMES)) {
    if (value.toUpperCase() === normalizedHex) {
      return name;
    }
  }
  return undefined;
}

// Calculate contrast ratio between two colors (for accessibility)
export function getContrastRatio(color1: Color, color2: Color): number {
  if (!(color1.rgb && color2.rgb)) return 0;

  const getLuminance = (rgb: { r: number; g: number; b: number }): number => {
    const [red, green, blue] = [rgb.r, rgb.g, rgb.b].map((c) => {
      const cNorm = c / 255;
      return cNorm <= 0.039_28
        ? cNorm / 12.92
        : ((cNorm + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };

  const lum1 = getLuminance(color1.rgb);
  const lum2 = getLuminance(color2.rgb);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);

  return (brightest + 0.05) / (darkest + 0.05);
}
