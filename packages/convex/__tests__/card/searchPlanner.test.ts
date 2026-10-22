import { describe, expect, test } from "bun:test";
import { narrowTypesForQuery } from "../../card/searchPlanner";
import type { CardType } from "../../schema";
import { parseSearchQuery } from "../../shared/search/qualifiers";

describe("narrowTypesForQuery", () => {
  test.each<[string, CardType[] | undefined, CardType[] | null | undefined]>([
    ["design", undefined, undefined],
    ["design", [], undefined],
    ["design", ["image", "video"], ["image", "video"]],
    ["type:image", undefined, ["image"]],
    ["type:image", ["image", "link"], ["image"]],
    ["type:image", ["link"], null],
    ["is:done", undefined, ["link"]],
    ["is:todo", ["link", "image"], ["link"]],
    ["is:done", ["image"], null],
    ["is:done is:todo", undefined, null],
    ["price:<100", undefined, ["link"]],
    ["type:image price:<100", undefined, null],
    ["mood:cozy", undefined, ["image"]],
    ["mood:cozy", ["image", "video"], ["image"]],
    ["mood:cozy", ["video"], null],
    ["is:done mood:cozy", undefined, null],
  ])("%p within %p narrows to %p", (query, types, expected) => {
    expect(narrowTypesForQuery(parseSearchQuery(query), types)).toEqual(
      expected
    );
  });
});
