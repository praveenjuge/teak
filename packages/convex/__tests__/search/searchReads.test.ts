import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { isSearchTooBroad, searchTooBroad } from "../../search/searchReads";

describe("isSearchTooBroad", () => {
  test("recognises the too-broad error clients see as invalid input", () => {
    const error = searchTooBroad();
    expect(error.data).toMatchObject({
      code: "INVALID_INPUT",
      message: "Search is too broad. Add a type or date filter.",
    });
    expect(isSearchTooBroad(error)).toBe(true);
  });

  test("leaves other invalid input alone, so it isn't retried as a wider search", () => {
    expect(
      isSearchTooBroad(
        new ConvexError({ code: "INVALID_INPUT", message: "Bad cursor" })
      )
    ).toBe(false);
    expect(isSearchTooBroad(new Error("Search is too broad"))).toBe(false);
  });
});
