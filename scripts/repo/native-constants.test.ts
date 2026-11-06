import { expect, test } from "bun:test";
import { renderSharedConstants as renderAndroid } from "../../apps/android/scripts/shared-constants";
import { renderSharedConstants as renderApple } from "../../apps/apple/scripts/shared-constants";
import { MAX_COLUMNS } from "../../apps/web/src/components/grids/gridColumns";
import { loadFixture } from "../../packages/convex/__tests__/shared/loadFixture";
import { COLOR_HUE_BUCKETS } from "../../packages/convex/shared/constants";
import { buildNativeConstants, COLOR_HUE_SWATCHES } from "./native-constants";

const GROUPS = new Set(["limits", "messages", "searchSuggestionHints"]);

const leafKeys = () =>
  Object.entries(buildNativeConstants()).flatMap(([key, value]) =>
    GROUPS.has(key)
      ? Object.keys(value).map((inner) => `${key}.${inner}`)
      : [key]
  );

test("every color filter has a swatch", () => {
  expect(Object.keys(COLOR_HUE_SWATCHES)).toEqual([...COLOR_HUE_BUCKETS]);
});

test("Apple's JSON carries every value in the manifest", () => {
  const apple = JSON.parse(renderApple()) as Record<string, unknown>;
  for (const key of leafKeys()) {
    const [group, inner] = key.split(".");
    const value = inner
      ? (apple[group as string] as Record<string, unknown>)[inner]
      : apple[key];
    expect(value, key).toBeDefined();
  }
});

test("Android's Kotlin declares every value in the manifest once", () => {
  const names = [...renderAndroid().matchAll(/^(?:const )?val (\w+)/gm)].map(
    (match) => match[1]
  );
  expect(names).toHaveLength(leafKeys().length);
  expect(new Set(names).size).toBe(names.length);
});

test("the widest native grid shows as many columns as the web's", () => {
  const { columns } = loadFixture<{
    columns: { columns: number; width: number }[];
  }>("cardGrid");
  expect(Math.max(...columns.map((row) => row.columns))).toBe(MAX_COLUMNS);
});
