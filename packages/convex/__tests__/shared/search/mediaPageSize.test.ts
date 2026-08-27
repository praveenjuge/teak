import { describe, expect, test } from "bun:test";
import { SEARCH_DEFAULT_CARD_LIMIT } from "../../../shared/search/constants";

describe("media grid page size", () => {
  test("bounds the initial media request fan-out", () => {
    expect(SEARCH_DEFAULT_CARD_LIMIT).toBe(30);
  });
});
