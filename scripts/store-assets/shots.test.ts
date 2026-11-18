import { describe, expect, test } from "bun:test";
import { FEATURE_GRAPHIC, STORES } from "./shots.ts";

const headlines = [
  ...Object.entries(STORES).flatMap(([id, store]) =>
    store.shots.map(({ name, headline }) => ({
      shot: `${id}/${name}`,
      headline,
    }))
  ),
  { shot: "android/feature_graphic", headline: FEATURE_GRAPHIC.headline },
];

describe("store headlines", () => {
  test.each(headlines)(
    "$shot leaves the line break to render.ts",
    ({ headline }) => {
      // render.ts balances every headline into two lines, so a typed break
      // would fight it, and a headline needs a space it can break at.
      expect(headline).not.toContain("\n");
      expect(headline.trim()).toBe(headline);
      expect(headline).toMatch(/\S \S/);
    }
  );
});
