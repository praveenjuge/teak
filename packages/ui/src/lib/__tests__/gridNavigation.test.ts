import { describe, expect, test } from "bun:test";
import {
  type GridDirection,
  type GridRect,
  nextCardIndex,
} from "../gridNavigation";

const card = (left: number, top: number, height: number, width = 100) =>
  ({ left, top, right: left + width, bottom: top + height }) as GridRect;

// Three uneven masonry columns (gutter 20), in reading order:
//
//   0 (tall)   1 (short)  2
//              3          4 (tall)
//   5          6
//              7
//                         8
const masonry = [
  card(0, 0, 300), //    0
  card(120, 0, 80), //   1
  card(240, 0, 140), //  2
  card(120, 100, 120), // 3
  card(240, 160, 300), // 4
  card(0, 320, 100), //  5
  card(120, 240, 90), // 6
  card(120, 350, 60), // 7
  card(240, 480, 50), // 8
];

const singleColumn = [card(0, 0, 50), card(0, 70, 200), card(0, 290, 30)];

describe("nextCardIndex", () => {
  test.each<[string, GridRect[], number, GridDirection, number]>([
    // Up and down stay in the column, to the nearest card.
    ["down the middle column", masonry, 1, "down", 3],
    ["down again", masonry, 3, "down", 6],
    ["up the middle column", masonry, 6, "up", 3],
    ["down a tall card's column", masonry, 0, "down", 5],
    ["up from the top edge stays", masonry, 2, "up", 2],
    // Past a column's end, down goes to the nearest card below, if any.
    ["down past a column's end", masonry, 5, "down", 8],
    ["down past another column's end", masonry, 7, "down", 8],
    ["down from the last row stays", masonry, 8, "down", 8],
    ["down onto a tall card", masonry, 2, "down", 4],
    // Left and right go to the next column, to the card most beside this one.
    ["right from a tall card", masonry, 0, "right", 3],
    ["right to the nearest center", masonry, 3, "right", 2],
    ["right into a tall card", masonry, 6, "right", 4],
    ["left from a tall card", masonry, 4, "left", 6],
    ["left from the bottom of a column", masonry, 7, "left", 5],
    ["left at the edge stays", masonry, 5, "left", 5],
    ["right at the edge stays", masonry, 4, "right", 4],
    // Next and previous follow reading order.
    ["next", masonry, 3, "next", 4],
    ["previous", masonry, 3, "previous", 2],
    ["next at the end stays", masonry, 8, "next", 8],
    ["previous at the start stays", masonry, 0, "previous", 0],
    // One column: up and down step through it, sideways goes nowhere.
    ["single column down", singleColumn, 0, "down", 1],
    ["single column up", singleColumn, 2, "up", 1],
    ["single column right", singleColumn, 1, "right", 1],
    ["single column end", singleColumn, 2, "down", 2],
  ])("%s", (_name, rects, from, direction, expected) => {
    expect(nextCardIndex(rects, from, direction)).toBe(expected);
  });

  test("ignores rounding between cards in one column", () => {
    const rects = [card(0, 0, 100), card(0.4, 99.5, 100), card(120, 0, 100)];
    expect(nextCardIndex(rects, 0, "down")).toBe(1);
    expect(nextCardIndex(rects, 1, "up")).toBe(0);
  });

  test("an unknown or missing card stays put", () => {
    expect(nextCardIndex([], 0, "down")).toBe(0);
    expect(nextCardIndex(masonry, 42, "left")).toBe(42);
  });
});
