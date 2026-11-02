import { describe, expect, test } from "bun:test";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { ConvexError } from "convex/values";
import {
  inPinOrder,
  isPinLimitError,
  movedIds,
  showsPinnedStrip,
  withPinnedFirst,
} from "../pinnedCards";

const card = (id: string, pinPosition?: number) =>
  ({
    _id: id as Id<"cards">,
    content: id,
    pinPosition,
  }) as Doc<"cards">;

describe("showsPinnedStrip", () => {
  test("shows on the plain library only", () => {
    const plain = { isFolderView: false, queryArgs: {}, view: "all" as const };
    expect(showsPinnedStrip(plain)).toBe(true);
    expect(showsPinnedStrip({ ...plain, view: "favorites" })).toBe(false);
    expect(showsPinnedStrip({ ...plain, isFolderView: true })).toBe(false);
  });

  test.each([
    { searchQuery: "design" },
    { types: ["link" as const] },
    { tag: "ideas" },
    { hueFilters: ["red" as const] },
    { favoritesOnly: true },
    { showArchivedOnly: true },
    { showTrashOnly: true },
    { sort: "oldest" as const },
    { sort: "shuffle" as const, shuffleSeed: 4 },
    { createdAtRange: { start: 1, end: 2 } },
  ])("hides for a search, filter or other sort: %p", (queryArgs) => {
    expect(
      showsPinnedStrip({ isFolderView: false, queryArgs, view: "all" })
    ).toBe(false);
  });
});

describe("pin order", () => {
  test("a new pin goes first, before the first pin's place", () => {
    const pinned = [card("a", -1), card("b", 0)];
    const next = withPinnedFirst(pinned, card("c"));
    expect(next.map((item) => item._id)).toEqual(["c", "a", "b"]);
    expect(next[0]?.pinPosition).toBe(-2);
    expect(withPinnedFirst([], card("c"))[0]?.pinPosition).toBe(0);
  });

  test("pinning a pinned card again doesn't list it twice", () => {
    const pinned = [card("a", 0), card("b", 1)];
    expect(
      withPinnedFirst(pinned, card("b", 1)).map((item) => item._id)
    ).toEqual(["b", "a"]);
  });

  test("a new order renumbers the pins and drops ids that aren't pinned", () => {
    const pinned = [card("a", -3), card("b", 5), card("c", 9)];
    const next = inPinOrder(pinned, ["c", "a", "zzz", "b"]);
    expect(next.map((item) => [item._id, item.pinPosition])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 3],
    ]);
  });

  test("moving a card puts it at the drop position", () => {
    expect(movedIds(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(movedIds(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(movedIds(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});

describe("isPinLimitError", () => {
  test("knows the cap's error by its code", () => {
    expect(
      isPinLimitError(new ConvexError({ code: "PIN_LIMIT_REACHED" }))
    ).toBe(true);
    expect(isPinLimitError(new ConvexError({ code: "CONFLICT" }))).toBe(false);
    expect(isPinLimitError(new Error("PIN_LIMIT_REACHED"))).toBe(false);
  });
});
