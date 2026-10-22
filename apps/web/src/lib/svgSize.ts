const SVG_ROOT_TAG = /<svg\b[^>]*>/i;
const PIXEL_LENGTH = /^\s*\d+(?:\.\d+)?(?:px)?\s*$/i;

function rootAttributePattern(name: string): RegExp {
  // Leading whitespace keeps `stroke-width` from matching `width`.
  return new RegExp(`(\\s${name}\\s*=\\s*)(["'])(.*?)\\2`, "i");
}

/**
 * Gives an SVG's root element the width and height it needs to rasterize at
 * a known size. Pixel sizes the SVG already sets are kept; a missing or
 * relative size (`100%`, `1em`) is set to the given one. Each attribute
 * appears once, since a repeated attribute makes the SVG invalid XML.
 */
export function sizeSvgRoot(
  svgText: string,
  width: number,
  height: number
): string {
  return svgText.replace(SVG_ROOT_TAG, (tag) => {
    let sized = tag;
    for (const [name, value] of [
      ["width", width],
      ["height", height],
    ] as const) {
      const pattern = rootAttributePattern(name);
      const existing = sized.match(pattern);
      if (!existing) {
        sized = sized.replace(/^<svg\b/i, `$& ${name}="${value}"`);
      } else if (!PIXEL_LENGTH.test(existing[3])) {
        sized = sized.replace(pattern, `$1"${value}"`);
      }
    }
    return sized;
  });
}
