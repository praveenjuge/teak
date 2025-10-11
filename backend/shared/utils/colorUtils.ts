// Color utility functions for parsing and working with colors

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
  aliceblue: '#F0F8FF',
  antiquewhite: '#FAEBD7',
  aqua: '#00FFFF',
  aquamarine: '#7FFFD4',
  azure: '#F0FFFF',
  beige: '#F5F5DC',
  bisque: '#FFE4C4',
  black: '#000000',
  blanchedalmond: '#FFEBCD',
  blue: '#0000FF',
  blueviolet: '#8A2BE2',
  brown: '#A52A2A',
  burlywood: '#DEB887',
  cadetblue: '#5F9EA0',
  chartreuse: '#7FFF00',
  chocolate: '#D2691E',
  coral: '#FF7F50',
  cornflowerblue: '#6495ED',
  cornsilk: '#FFF8DC',
  crimson: '#DC143C',
  cyan: '#00FFFF',
  darkblue: '#00008B',
  darkcyan: '#008B8B',
  darkgoldenrod: '#B8860B',
  darkgray: '#A9A9A9',
  darkgrey: '#A9A9A9',
  darkgreen: '#006400',
  darkkhaki: '#BDB76B',
  darkmagenta: '#8B008B',
  darkolivegreen: '#556B2F',
  darkorange: '#FF8C00',
  darkorchid: '#9932CC',
  darkred: '#8B0000',
  darksalmon: '#E9967A',
  darkseagreen: '#8FBC8F',
  darkslateblue: '#483D8B',
  darkslategray: '#2F4F4F',
  darkslategrey: '#2F4F4F',
  darkturquoise: '#00CED1',
  darkviolet: '#9400D3',
  deeppink: '#FF1493',
  deepskyblue: '#00BFFF',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1E90FF',
  firebrick: '#B22222',
  floralwhite: '#FFFAF0',
  forestgreen: '#228B22',
  fuchsia: '#FF00FF',
  gainsboro: '#DCDCDC',
  ghostwhite: '#F8F8FF',
  gold: '#FFD700',
  goldenrod: '#DAA520',
  gray: '#808080',
  grey: '#808080',
  green: '#008000',
  greenyellow: '#ADFF2F',
  honeydew: '#F0FFF0',
  hotpink: '#FF69B4',
  indianred: '#CD5C5C',
  indigo: '#4B0082',
  ivory: '#FFFFF0',
  khaki: '#F0E68C',
  lavender: '#E6E6FA',
  lavenderblush: '#FFF0F5',
  lawngreen: '#7CFC00',
  lemonchiffon: '#FFFACD',
  lightblue: '#ADD8E6',
  lightcoral: '#F08080',
  lightcyan: '#E0FFFF',
  lightgoldenrodyellow: '#FAFAD2',
  lightgray: '#D3D3D3',
  lightgrey: '#D3D3D3',
  lightgreen: '#90EE90',
  lightpink: '#FFB6C1',
  lightsalmon: '#FFA07A',
  lightseagreen: '#20B2AA',
  lightskyblue: '#87CEFA',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#B0C4DE',
  lightyellow: '#FFFFE0',
  lime: '#00FF00',
  limegreen: '#32CD32',
  linen: '#FAF0E6',
  magenta: '#FF00FF',
  maroon: '#800000',
  mediumaquamarine: '#66CDAA',
  mediumblue: '#0000CD',
  mediumorchid: '#BA55D3',
  mediumpurple: '#9370DB',
  mediumseagreen: '#3CB371',
  mediumslateblue: '#7B68EE',
  mediumspringgreen: '#00FA9A',
  mediumturquoise: '#48D1CC',
  mediumvioletred: '#C71585',
  midnightblue: '#191970',
  mintcream: '#F5FFFA',
  mistyrose: '#FFE4E1',
  moccasin: '#FFE4B5',
  navajowhite: '#FFDEAD',
  navy: '#000080',
  oldlace: '#FDF5E6',
  olive: '#808000',
  olivedrab: '#6B8E23',
  orange: '#FFA500',
  orangered: '#FF4500',
  orchid: '#DA70D6',
  palegoldenrod: '#EEE8AA',
  palegreen: '#98FB98',
  paleturquoise: '#AFEEEE',
  palevioletred: '#DB7093',
  papayawhip: '#FFEFD5',
  peachpuff: '#FFDAB9',
  peru: '#CD853F',
  pink: '#FFC0CB',
  plum: '#DDA0DD',
  powderblue: '#B0E0E6',
  purple: '#800080',
  red: '#FF0000',
  rosybrown: '#BC8F8F',
  royalblue: '#4169E1',
  saddlebrown: '#8B4513',
  salmon: '#FA8072',
  sandybrown: '#F4A460',
  seagreen: '#2E8B57',
  seashell: '#FFF5EE',
  sienna: '#A0522D',
  silver: '#C0C0C0',
  skyblue: '#87CEEB',
  slateblue: '#6A5ACD',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#FFFAFA',
  springgreen: '#00FF7F',
  steelblue: '#4682B4',
  tan: '#D2B48C',
  teal: '#008080',
  thistle: '#D8BFD8',
  tomato: '#FF6347',
  turquoise: '#40E0D0',
  violet: '#EE82EE',
  wheat: '#F5DEB3',
  white: '#FFFFFF',
  whitesmoke: '#F5F5F5',
  yellow: '#FFFF00',
  yellowgreen: '#9ACD32',
};

// Convert hex to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let normalized = hex.replace(/^#/, '');

  if (normalized.length === 3 || normalized.length === 4) {
    normalized = normalized
      .split('')
      .map((char) => char + char)
      .join('');
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
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    }
    : null;
}

// Convert RGB to HSL
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;

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
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360;
  s /= 100;
  l /= 100;

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

// Convert RGB to hex
function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
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
        .split('')
        .map((char) => char + char)
        .join('');
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
  const rgbMatch = text.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]);
    const g = parseInt(rgbMatch[2]);
    const b = parseInt(rgbMatch[3]);

    if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
      const hex = rgbToHex(r, g, b);
      const hsl = rgbToHsl(r, g, b);

      return {
        hex,
        rgb: { r, g, b },
        hsl,
      };
    }
  }

  // Try HSL format
  const hslMatch = text.match(/hsla?\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*(?:,\s*[\d.]+\s*)?\)/);
  if (hslMatch) {
    const h = parseInt(hslMatch[1]);
    const s = parseInt(hslMatch[2]);
    const l = parseInt(hslMatch[3]);

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
  const colorName = text.replace(/[^a-z]/g, '');
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
    ...text.matchAll(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/gi),
    ...text.matchAll(/hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(?:,\s*[\d.]+\s*)?\)/gi),
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
  const cleaned = slug.replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function extractPaletteColors(text: string): Color[] {
  const result = new Map<string, Color>();

  const addColor = (color: Color | null, inferredName?: string) => {
    if (!color) return;
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

  for (const match of text.matchAll(/--([a-z0-9_-]+)\s*:\s*([^;{}\n]+)[;}]?/gi)) {
    const [, slug, value] = match;
    const parsed = parseColorString(value.trim());
    addColor(parsed, formatPaletteName(slug));
  }

  for (const color of parseColorsFromText(text)) {
    addColor(color, color.name);
  }

  return Array.from(result.values());
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
  if (!color1.rgb || !color2.rgb) return 0;

  const getLuminance = (rgb: { r: number; g: number; b: number }): number => {
    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const lum1 = getLuminance(color1.rgb);
  const lum2 = getLuminance(color2.rgb);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);

  return (brightest + 0.05) / (darkest + 0.05);
}
