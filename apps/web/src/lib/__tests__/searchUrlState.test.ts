import { describe, expect, test } from "bun:test";
import {
  EMPTY_SEARCH_URL_STATE,
  isSameSearchUrlState,
  MAX_URL_SEARCH_LENGTH,
  parseSearchUrlState,
  queryOrder,
  serializeSearchUrlState,
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

describe("shuffle seeds in the URL", () => {
  test("reads a seed with the Shuffle sort", () => {
    expect(parse("sort=shuffle&seed=42")).toMatchObject({
      seed: 42,
      sort: "shuffle",
    });
  });

  test.each([
    ["no seed", "sort=shuffle"],
    ["a negative seed", "sort=shuffle&seed=-1"],
    ["a fraction", "sort=shuffle&seed=1.5"],
    ["a seed out of range", "sort=shuffle&seed=2147483648"],
    ["text", "sort=shuffle&seed=abc"],
  ])("leaves %s for the screen to pick", (_label, query) => {
    const state = parse(query);
    expect(state.sort).toBe("shuffle");
    expect(state).not.toHaveProperty("seed");
  });

  test("ignores a seed with a date sort", () => {
    expect(parse("sort=oldest&seed=42")).not.toHaveProperty("seed");
    expect(
      serializeSearchUrlState(
        { q: "", seed: 42, sort: "newest", types: [] },
        "sort=shuffle&seed=7"
      )
    ).toBe("");
  });

  test("round-trips, so a shared link shows the same order", () => {
    const state = {
      q: "",
      seed: 2_147_483_647,
      sort: "shuffle" as const,
      tag: "",
      types: [],
    };
    const query = serializeSearchUrlState(state);
    expect(query).toBe("sort=shuffle&seed=2147483647");
    expect(parse(query)).toEqual(state);
  });

  test("a reshuffle is a different search state", () => {
    const shuffled = { q: "", seed: 1, sort: "shuffle" as const, types: [] };
    expect(isSameSearchUrlState(shuffled, { ...shuffled, seed: 2 })).toBe(
      false
    );
    expect(isSameSearchUrlState(shuffled, { ...shuffled })).toBe(true);
  });
});

describe("Revisit in the URL", () => {
  test("round-trips with its seed, so a reload deals from the same seed", () => {
    const state = parse("sort=revisit&seed=42&tag=rv20");
    expect(state).toEqual({
      q: "",
      seed: 42,
      sort: "revisit",
      tag: "rv20",
      types: [],
    });
    expect(serializeSearchUrlState(state)).toBe(
      "sort=revisit&seed=42&tag=rv20"
    );
  });

  test.each([
    ["no seed", "sort=revisit"],
    ["a negative seed", "sort=revisit&seed=-1"],
    ["text", "sort=revisit&seed=abc"],
  ])("drops %s and keeps Revisit, for the screen to pick one", (_, query) => {
    const state = parse(query);
    expect(state.sort).toBe("revisit");
    expect(state).not.toHaveProperty("seed");
  });

  test("queries as a Shuffle of its seed", () => {
    expect(queryOrder({ seed: 42, sort: "revisit" })).toEqual({
      shuffleSeed: 42,
      sort: "shuffle",
    });
    expect(queryOrder({ seed: 42, sort: "oldest" })).toEqual({
      sort: "oldest",
    });
  });

  test("is a different search from a Shuffle of the same seed", () => {
    const revisit = { q: "", seed: 7, sort: "revisit" as const, types: [] };
    expect(isSameSearchUrlState(revisit, { ...revisit, sort: "shuffle" })).toBe(
      false
    );
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
  test("reads a tag trimmed and lowercased, without cutting a long tag", () => {
    expect(parse("tag=%20Design%20").tag).toBe("design");
    expect(parse(`tag=${"x".repeat(300)}`).tag).toHaveLength(256);
    // 64 capital İ lowercase to 128 code units; the key stays whole.
    const dotted = "İ".repeat(64);
    expect(parse(new URLSearchParams({ tag: dotted }).toString()).tag).toBe(
      dotted.toLowerCase()
    );
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
