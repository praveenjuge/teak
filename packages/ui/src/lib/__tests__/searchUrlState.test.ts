import { describe, expect, test } from "bun:test";
import {
  EMPTY_SEARCH_URL_STATE,
  isSameSearchUrlState,
  MAX_URL_SEARCH_LENGTH,
  parseSearchUrlState,
  serializeSearchUrlState,
  toggleSearchUrlType,
} from "../searchUrlState";

const parse = (query: string) =>
  parseSearchUrlState(new URLSearchParams(query));

describe("parseSearchUrlState", () => {
  test("reads q and sort", () => {
    expect(parse("q=blue%20buttons&sort=oldest")).toEqual({
      q: "blue buttons",
      sort: "oldest",
      types: [],
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
      { q: "design", sort: "oldest", types: [] },
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
      serializeSearchUrlState(
        { q: "  ", sort: "newest", types: [] },
        "q=old&sort=oldest"
      )
    ).toBe("");
  });

  test("round-trips through the URL", () => {
    const state = {
      q: "a & b = c?",
      sort: "oldest" as const,
      types: ["link" as const, "quote" as const],
    };
    expect(parse(serializeSearchUrlState(state))).toEqual(state);
  });
});

test("isSameSearchUrlState ignores surrounding spaces", () => {
  expect(
    isSameSearchUrlState(
      { q: " design ", sort: "newest", types: [] },
      { q: "design", sort: "newest", types: [] }
    )
  ).toBe(true);
  expect(
    isSameSearchUrlState(
      { q: "design", sort: "newest", types: [] },
      { q: "design", sort: "oldest", types: [] }
    )
  ).toBe(false);
});

describe("card types in the URL", () => {
  test("reads known types once each, in order, ignoring case", () => {
    expect(parse("type=Image,link,bogus,image,,quote").types).toEqual([
      "image",
      "link",
      "quote",
    ]);
  });

  test("writes types as a readable comma list and drops an empty one", () => {
    expect(
      serializeSearchUrlState(
        { q: "", sort: "newest", types: ["link", "image"] },
        "card=abc"
      )
    ).toBe("card=abc&type=link,image");
    expect(
      serializeSearchUrlState({ q: "", sort: "newest", types: [] }, "type=link")
    ).toBe("");
  });

  test("toggles one type on and off", () => {
    const on = toggleSearchUrlType(EMPTY_SEARCH_URL_STATE, "video");
    expect(on.types).toEqual(["video"]);
    expect(toggleSearchUrlType(on, "video").types).toEqual([]);
  });

  test("compares types regardless of order", () => {
    const base = { q: "a", sort: "newest" as const };
    expect(
      isSameSearchUrlState(
        { ...base, types: ["link", "image"] },
        { ...base, types: ["image", "link"] }
      )
    ).toBe(true);
    expect(
      isSameSearchUrlState(
        { ...base, types: ["link"] },
        { ...base, types: ["link", "image"] }
      )
    ).toBe(false);
  });
});
