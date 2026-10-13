import { describe, expect, test } from "bun:test";
import {
  isSameSearchUrlState,
  MAX_URL_SEARCH_LENGTH,
  parseSearchUrlState,
  serializeSearchUrlState,
} from "../searchUrlState";

const parse = (query: string) =>
  parseSearchUrlState(new URLSearchParams(query));

describe("parseSearchUrlState", () => {
  test("reads q and sort", () => {
    expect(parse("q=blue%20buttons&sort=oldest")).toEqual({
      q: "blue buttons",
      sort: "oldest",
    });
  });

  test.each([
    ["no params", ""],
    ["an unknown sort", "sort=random"],
    ["an empty sort", "sort="],
    ["a newest sort", "sort=newest"],
  ])("falls back to newest for %s", (_label, query) => {
    expect(parse(query).sort).toBe("newest");
  });

  test("clips a very long search", () => {
    expect(parse(`q=${"a".repeat(2000)}`).q).toHaveLength(
      MAX_URL_SEARCH_LENGTH
    );
  });

  test("keeps emoji, RTL and CJK text intact", () => {
    const q = "🎨 مرحبا 東京";
    expect(parse(new URLSearchParams({ q }).toString()).q).toBe(q);
  });
});

describe("serializeSearchUrlState", () => {
  test("keeps the open card and other params", () => {
    const query = serializeSearchUrlState(
      { q: "design", sort: "oldest" },
      "card=abc&utm_source=x"
    );
    const params = new URLSearchParams(query);
    expect(params.get("card")).toBe("abc");
    expect(params.get("utm_source")).toBe("x");
    expect(params.get("q")).toBe("design");
    expect(params.get("sort")).toBe("oldest");
  });

  test("leaves defaults out of the URL", () => {
    expect(
      serializeSearchUrlState({ q: "  ", sort: "newest" }, "q=old&sort=oldest")
    ).toBe("");
  });

  test("round-trips through the URL", () => {
    const state = { q: "a & b = c?", sort: "oldest" as const };
    expect(parse(serializeSearchUrlState(state))).toEqual(state);
  });
});

test("isSameSearchUrlState ignores surrounding spaces", () => {
  expect(
    isSameSearchUrlState(
      { q: " design ", sort: "newest" },
      { q: "design", sort: "newest" }
    )
  ).toBe(true);
  expect(
    isSameSearchUrlState(
      { q: "design", sort: "newest" },
      { q: "design", sort: "oldest" }
    )
  ).toBe(false);
});
