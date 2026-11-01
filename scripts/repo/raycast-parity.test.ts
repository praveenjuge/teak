// Raycast can't import the workspace when it ships, so it keeps small copies
// of a few of Teak's tables. These tests check each copy against the original.
// They live here, outside apps/raycast, so the published extension never
// carries a test that needs the monorepo.
import { expect, test } from "bun:test";
import { HIDDEN_TAGS } from "../../apps/raycast/src/lib/hiddenTags";
import {
  HUE_OPTIONS,
  STYLE_OPTIONS,
} from "../../apps/raycast/src/lib/searchFilters";
import {
  COLOR_HUE_BUCKETS,
  VISUAL_STYLE_TAXONOMY,
} from "../../packages/convex/shared/constants";
import { HIDDEN_TAG_KEYS } from "../../packages/convex/shared/tags";
import { DONE_VERBS_PATH, renderDoneVerbs } from "./raycast-done-verbs";

test("offers the same hue and style filters as Teak's search", () => {
  expect(HUE_OPTIONS).toEqual(COLOR_HUE_BUCKETS);
  expect(STYLE_OPTIONS).toEqual(VISUAL_STYLE_TAXONOMY);
});

test("names a link's done state the way Teak's apps do", async () => {
  // Regenerate with: bun --no-env-file run scripts/repo/raycast-done-verbs.ts --write
  expect(await Bun.file(DONE_VERBS_PATH).text()).toBe(renderDoneVerbs());
});

test("hides the same tags as Teak's search", () => {
  expect([...HIDDEN_TAGS]).toEqual([...HIDDEN_TAG_KEYS]);
});
