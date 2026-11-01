import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../theme.css", import.meta.url), "utf8");

const block = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
};

const token = (scope: string, name: string) => {
  const match = block(scope).match(
    new RegExp(`--${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`)
  );
  if (!match) {
    throw new Error(`No --${name} in ${scope}`);
  }
  return match.slice(1).map(Number) as [number, number, number];
};

// OKLCH to linear sRGB (Björn Ottosson's OKLab matrices), then WCAG
// relative luminance.
const luminance = ([l, c, h]: [number, number, number]) => {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m_ = (l - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s_ = (l - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const r = clamp(
    4.076_741_662_1 * l_ - 3.307_711_591_3 * m_ + 0.230_969_929_2 * s_
  );
  const g = clamp(
    -1.268_438_004_6 * l_ + 2.609_757_401_1 * m_ - 0.341_319_396_5 * s_
  );
  const bl = clamp(
    -0.004_196_086_3 * l_ - 0.703_418_614_7 * m_ + 1.707_614_701 * s_
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
};

const contrast = (x: [number, number, number], y: [number, number, number]) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

describe("keyboard focus ring", () => {
  test("is at least 3:1 against the page and Teak red, in light and dark", () => {
    for (const scope of [":root", ".dark"]) {
      const ring = token(scope, "focus-ring");
      expect(contrast(ring, token(scope, "background"))).toBeGreaterThan(3);
      expect(contrast(ring, token(scope, "primary"))).toBeGreaterThan(3);
    }
  });

  test("overrides the faint half-opacity ring utilities and shows at once", () => {
    expect(css).toMatch(
      /\n:focus-visible \{\n {2}--tw-ring-color: var\(--focus-ring\);/
    );
    const instant = block('[class*="focus-visible:ring"]:focus-visible');
    expect(instant).toContain("transition-property");
    expect(instant).not.toContain("box-shadow");
  });
});
