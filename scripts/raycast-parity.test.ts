// Raycast can't import the workspace when it ships, so it keeps small copies
// of a few of Teak's tables. These tests check each copy against the original.
// They live here, outside apps/raycast, so the published extension never
// carries a test that needs the monorepo.
import { expect, test } from "bun:test";
import { DONE_VERB_BY_CATEGORY } from "../apps/raycast/src/lib/doneStates";
import { HIDDEN_TAGS } from "../apps/raycast/src/lib/hiddenTags";
import {
  HUE_OPTIONS,
  STYLE_OPTIONS,
} from "../apps/raycast/src/lib/searchFilters";
import {
  COLOR_HUE_BUCKETS,
  VISUAL_STYLE_TAXONOMY,
} from "../packages/convex/shared/constants";
import {
  LINK_CATEGORIES,
  LINK_CATEGORY_DONE_VERB,
} from "../packages/convex/shared/linkCategories";
import { HIDDEN_TAG_KEYS } from "../packages/convex/shared/tags";

test("offers the same hue and style filters as Teak's search", () => {
  expect(HUE_OPTIONS).toEqual(COLOR_HUE_BUCKETS);
  expect(STYLE_OPTIONS).toEqual(VISUAL_STYLE_TAXONOMY);
});

test("names a link's done state the way Teak's apps do", () => {
  expect(Object.keys(DONE_VERB_BY_CATEGORY).sort()).toEqual(
    [...LINK_CATEGORIES].sort()
  );
  expect(DONE_VERB_BY_CATEGORY).toEqual(LINK_CATEGORY_DONE_VERB);
});

test("hides the same tags as Teak's search", () => {
  expect([...HIDDEN_TAGS]).toEqual([...HIDDEN_TAG_KEYS]);
});
