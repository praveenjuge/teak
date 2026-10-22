import { describe, expect, test } from "bun:test";
import {
  EMPTY_SEARCH_URL_STATE,
  isSameSearchUrlState,
  MAX_URL_SEARCH_LENGTH,
  parseSearchUrlState,
  queryOrder,
  serializeSearchUrlState,
  timeFilterFromUrl,
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

describe("Newest picked over Best match", () => {
  const pickedNewest = {
    q: "lentil soup",
    sort: "newest" as const,
    sortPicked: true,
    tag: "",
    types: [],
  };

  test("writes the picked Newest sort and reads it back as picked", () => {
    const query = serializeSearchUrlState(pickedNewest);
    expect(new URLSearchParams(query).get("sort")).toBe("newest");
    expect(parse(query)).toEqual(pickedNewest);
  });

  test("a search left on its default sort still writes no sort", () => {
    expect(
      serializeSearchUrlState({ q: "lentil soup", sort: "newest", types: [] })
    ).toBe("q=lentil+soup");
    expect(parse("q=lentil+soup")).not.toHaveProperty("sortPicked");
  });

  test("tells a picked Newest apart from the default sort", () => {
    expect(
      isSameSearchUrlState(pickedNewest, { ...pickedNewest, sortPicked: false })
    ).toBe(false);
    expect(
      isSameSearchUrlState(pickedNewest, parse("q=lentil+soup&sort=newest"))
    ).toBe(true);
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

describe("colors, styles and dates in the URL", () => {
  test("round-trip, so a reload or a shared link keeps them", () => {
    const state = {
      ...EMPTY_SEARCH_URL_STATE,
      date: "This Week",
      hexes: ["#FF5733"],
      hues: ["red" as const, "blue" as const],
      styles: ["minimal" as const, "dark" as const],
    };
    const query = serializeSearchUrlState(state);
    expect(query).toBe(
      "style=minimal,dark&color=red,blue,ff5733&date=This+Week"
    );
    const read = parse(query);
    expect(read).toMatchObject({
      date: "This Week",
      hexes: ["#FF5733"],
      hues: ["red", "blue"],
      styles: ["minimal", "dark"],
    });
    expect(isSameSearchUrlState(read, state)).toBe(true);
  });

  test("read a date range's label back as a range", () => {
    expect(
      timeFilterFromUrl("Jan 1, 2026 – Mar 1, 2026", {
        now: new Date(2026, 5, 1),
      })?.range
    ).toEqual({
      end: new Date(2026, 2, 2).getTime(),
      start: new Date(2026, 0, 1).getTime(),
    });
  });

  test("drop unknown, repeated and malformed values", () => {
    expect(
      parse(
        "style=Minimal,shiny,minimal&color=Red,mauve,%23ff5733,FF5733,zzz&date=someday"
      )
    ).toEqual({
      hexes: ["#FF5733"],
      hues: ["red"],
      q: "",
      sort: "newest",
      styles: ["minimal"],
      tag: "",
      types: [],
    });
  });

  test("read at most a bounded length of each", () => {
    const read = parse(`color=${"ff5733,".repeat(200)}red`);
    expect(read.hues).toBeUndefined();
    expect(read.hexes).toEqual(["#FF5733"]);
    expect(parse(`date=${"today ".repeat(100)}`).date).toBeUndefined();
  });

  test("a different color is a different search", () => {
    expect(
      isSameSearchUrlState(
        { ...EMPTY_SEARCH_URL_STATE, hues: ["red"] },
        { ...EMPTY_SEARCH_URL_STATE, hues: ["blue"] }
      )
    ).toBe(false);
  });
});

test("a type: qualifier is the same search as that type picked", () => {
  expect(
    isSameSearchUrlState(
      { ...EMPTY_SEARCH_URL_STATE, q: "poster type:image" },
      { ...EMPTY_SEARCH_URL_STATE, q: "poster", types: ["image"] }
    )
  ).toBe(true);
});
