// Color interface (duplicate from shared to avoid importing client code)
interface Color {
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

// CSS color names mapping (subset of most common colors)
const COLOR_NAMES: Record<string, string> = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF',
  yellow: '#FFFF00', cyan: '#00FFFF', magenta: '#FF00FF', orange: '#FFA500', purple: '#800080',
  pink: '#FFC0CB', brown: '#A52A2A', gray: '#808080', grey: '#808080', silver: '#C0C0C0',
  lime: '#00FF00', maroon: '#800000', navy: '#000080', olive: '#808000', teal: '#008080',
  aqua: '#00FFFF', crimson: '#DC143C', coral: '#FF7F50', gold: '#FFD700', indigo: '#4B0082',
  khaki: '#F0E68C', plum: '#DDA0DD', salmon: '#FA8072', tan: '#D2B48C', violet: '#EE82EE'
};

// Convert hex to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  hex = hex.replace(/^#/, '');

  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }

  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
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

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
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
function parseColor(colorText: string): Color | null {
  const text = colorText.trim().toLowerCase();

  // Try hex format (#FF5733 or #f53)
  const hexMatch = text.match(/^#([a-f0-9]{3}|[a-f0-9]{6})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex.split('').map(char => char + char).join('');
    }
    hex = `#${hex.toUpperCase()}`;
    const rgb = hexToRgb(hex);
    const hsl = rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : undefined;

    return { hex, rgb: rgb || undefined, hsl };
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
      return { hex, rgb: { r, g, b }, hsl };
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
      return { hex, rgb, hsl: { h, s, l } };
    }
  }

  // Try color name
  const colorName = text.replace(/[^a-z]/g, '');
  if (COLOR_NAMES[colorName]) {
    const hex = COLOR_NAMES[colorName];
    const rgb = hexToRgb(hex);
    const hsl = rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : undefined;
    return { hex, name: colorName, rgb: rgb || undefined, hsl };
  }

  return null;
}

// Extract colors from content
function extractColorsFromContent(text: string): Color[] {
  const colors: Color[] = [];
  const seenHex = new Set<string>();

  // Split by common delimiters
  const parts = text.split(/[,;\n\r\t\s]+/);

  for (const part of parts) {
    const trimmedPart = part.trim();
    if (!trimmedPart) continue;

    const color = parseColor(trimmedPart);
    if (color && !seenHex.has(color.hex)) {
      colors.push(color);
      seenHex.add(color.hex);
    }
  }

  // Extract colors from within longer text
  const allMatches = [
    ...text.matchAll(/#([a-f0-9]{3}|[a-f0-9]{6})\b/gi),
    ...text.matchAll(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/gi),
    ...text.matchAll(/hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(?:,\s*[\d.]+\s*)?\)/gi),
  ];

  for (const match of allMatches) {
    const color = parseColor(match[0]);
    if (color && !seenHex.has(color.hex)) {
      colors.push(color);
      seenHex.add(color.hex);
    }
  }

  return colors;
}

export {
  type Color,
  COLOR_NAMES,
  hexToRgb,
  rgbToHsl,
  hslToRgb,
  rgbToHex,
  parseColor,
  extractColorsFromContent
};