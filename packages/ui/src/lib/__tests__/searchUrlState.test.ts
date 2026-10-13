import { describe, expect, test } from "bun:test";
import {
  EMPTY_SEARCH_URL_STATE,
  isSameSearchUrlState,
  MAX_URL_SEARCH_LENGTH,
  parseSearchUrlState,
  serializeSearchUrlState,
  toggleSearchUrlTag,
  toggleSearchUrlType,
} from "../searchUrlState";

const parse = (query: string) =>
  parseSearchUrlState(new URLSearchParams(query));

describe("parseSearchUrlState", () => {
  test("reads q and sort", () => {
    expect(parse("q=blue%20buttons&sort=oldest")).toEqual({
      q: "blue buttons",
      sort: "oldest",
      tag: "",
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
      tag: "design & dev",
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

describe("tag in the URL", () => {
  test("reads a tag trimmed and lowercased, clipped to 64 characters", () => {
    expect(parse("tag=%20Design%20").tag).toBe("design");
    expect(parse(`tag=${"x".repeat(100)}`).tag).toHaveLength(64);
    expect(parse("tag=%D8%AA%D8%B5%D9%85%D9%8A%D9%85").tag).toBe("تصميم");
  });

  test("writes the tag and drops an empty one, keeping other params", () => {
    expect(
      serializeSearchUrlState(
        { ...EMPTY_SEARCH_URL_STATE, tag: "UI Kits" },
        "card=c1"
      )
    ).toBe("card=c1&tag=ui+kits");
    expect(
      serializeSearchUrlState(EMPTY_SEARCH_URL_STATE, "tag=design&card=c1")
    ).toBe("card=c1");
  });

  test("toggles a tag on, swaps it for another, and off again", () => {
    const on = toggleSearchUrlTag(EMPTY_SEARCH_URL_STATE, "Design");
    expect(on.tag).toBe("design");
    expect(toggleSearchUrlTag(on, "web").tag).toBe("web");
    expect(toggleSearchUrlTag(on, "DESIGN").tag).toBe("");
  });

  test("compares tags ignoring case, and a missing tag as none", () => {
    expect(
      isSameSearchUrlState(
        { q: "", sort: "newest", types: [] },
        { ...EMPTY_SEARCH_URL_STATE, tag: "" }
      )
    ).toBe(true);
    expect(
      isSameSearchUrlState(
        { ...EMPTY_SEARCH_URL_STATE, tag: "Design" },
        { ...EMPTY_SEARCH_URL_STATE, tag: "design" }
      )
    ).toBe(true);
    expect(
      isSameSearchUrlState(EMPTY_SEARCH_URL_STATE, {
        ...EMPTY_SEARCH_URL_STATE,
        tag: "design",
      })
    ).toBe(false);
  });
});
