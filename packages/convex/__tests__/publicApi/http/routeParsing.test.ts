import { describe, expect, test } from "bun:test";
import {
  parseCardRoute,
  parseCardsQueryOptions,
  parseIncludeSet,
} from "../../../publicApi/http/routeParsing";

const API = "https://teak.convex.site";
const get = (query: string) => new Request(`${API}/v1/cards?${query}`);

const errorOf = async (result: unknown) => {
  expect(result).toBeInstanceOf(Response);
  const response = result as Response;
  return { body: await response.json(), status: response.status };
};

describe("parseIncludeSet", () => {
  test("parses known groups and ignores empty entries", () => {
    expect(parseIncludeSet("content, metadata,,processing")).toEqual(
      new Set(["content", "metadata", "processing"])
    );
    expect(parseIncludeSet(null)).toEqual(new Set());
  });

  test("rejects any unknown group", () => {
    expect(parseIncludeSet("content,secrets")).toBeNull();
  });
});

describe("parseCardsQueryOptions", () => {
  test("parses Trash and repeated visual filters", () => {
    expect(
      parseCardsQueryOptions(
        get("trashed=true&style=minimal&hue=blue&hex=%23abc&hex=112233")
      )
    ).toMatchObject({
      showTrashOnly: true,
      styleFilters: ["minimal"],
      hueFilters: ["blue"],
      hexFilters: ["#AABBCC", "#112233"],
    });
  });
  test.each(["only", "include", "exclude"])(
    "parses archived=%s",
    (archived: string) => {
      expect(parseCardsQueryOptions(get(`archived=${archived}`))).toMatchObject(
        { archived }
      );
    }
  );
  test("is:archived inside an OR reads archived cards too", () => {
    const q = encodeURIComponent("site:github.com (is:archived OR repo)");
    expect(parseCardsQueryOptions(get(`q=${q}`))).toMatchObject({
      archived: "include",
      qualifiers: { expression: "is:archived OR repo" },
    });
    // An explicit `archived` holds; the expression runs inside it.
    expect(
      parseCardsQueryOptions(get(`q=${q}&archived=exclude`))
    ).toMatchObject({ archived: "exclude" });
    expect(parseCardsQueryOptions(get(`q=${q}&archived=only`))).toMatchObject({
      archived: "only",
    });
    expect(
      parseCardsQueryOptions(get(`q=${encodeURIComponent("-is:archived x")}`))
    ).toMatchObject({ archived: undefined });
  });
  test.each([
    "trashed=yes",
    "style=unknown",
    "hue=unknown",
    "hex=badhex",
    "archived=true",
    "archived=",
  ])("rejects invalid filter %s", (query: string) => {
    const result = parseCardsQueryOptions(get(query));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });
  test("shuffle needs a whole-number seed", () => {
    expect(
      parseCardsQueryOptions(get("sort=shuffle&shuffleSeed=42"))
    ).toMatchObject({ sort: "shuffle", shuffleSeed: 42 });
    for (const query of [
      "sort=shuffle",
      "sort=shuffle&shuffleSeed=",
      "sort=shuffle&shuffleSeed=4.2",
      "sort=shuffle&shuffleSeed=-1",
      "sort=shuffle&shuffleSeed=2147483648",
      "sort=random",
    ]) {
      const result = parseCardsQueryOptions(get(query));
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(400);
    }
    expect(
      parseCardsQueryOptions(get("sort=newest&shuffleSeed=42"))
    ).not.toHaveProperty("shuffleSeed");
  });
  test("parses filters, favorites and a clamped limit", () => {
    expect(
      parseCardsQueryOptions(
        get(
          "q=design&type=link&tag=ideas&sort=oldest&favorited=true&limit=500&createdAfter=10&createdBefore=20&cursor=c1"
        )
      )
    ).toEqual({
      createdAfter: 10,
      createdBefore: 20,
      cursor: "c1",
      favoritesOnly: true,
      pinnedOnly: false,
      showTrashOnly: false,
      styleFilters: undefined,
      hueFilters: undefined,
      hexFilters: undefined,
      limit: 100,
      hasQuery: true,
      mode: "hybrid",
      searchQuery: "design",
      semantic: { kind: "text", text: "design", cacheText: "design" },
      similarity: null,
      sort: "oldest",
      tag: "ideas",
      type: "link",
      types: undefined,
    });
  });

  test("pinned=true and is:pinned both ask for pinned cards only", () => {
    const fromParam = parseCardsQueryOptions(get("pinned=true"));
    const fromQuery = parseCardsQueryOptions(get("q=is:pinned"));
    expect(fromParam).toMatchObject({ pinnedOnly: true });
    expect(fromQuery).toMatchObject({ pinnedOnly: true });
    expect(parseCardsQueryOptions(get(""))).toMatchObject({
      pinnedOnly: false,
    });
  });

  test("rejects a pinned value that isn't true or false", async () => {
    const response = parseCardsQueryOptions(get("pinned=yes"));
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(400);
    expect(await (response as Response).json()).toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  test("collects several types and falls back to the default limit", () => {
    expect(
      parseCardsQueryOptions(get("type=link&type=image&type=link&limit=10junk"))
    ).toMatchObject({ limit: 50, type: undefined, types: ["link", "image"] });
  });

  test.each([
    [
      "an unknown type",
      "type=spreadsheet",
      "Query parameter `type` is invalid",
    ],
    [
      "an unknown sort",
      "sort=popular",
      "Query parameter `sort` must be `newest`, `oldest`, `relevance` or `shuffle`",
    ],
    [
      "a non-numeric createdAfter",
      "createdAfter=yesterday",
      "Query parameter `createdAfter` must be a number",
    ],
    [
      "a reversed date range",
      "createdAfter=20&createdBefore=10",
      "`createdAfter` must be less than or equal to `createdBefore`",
    ],
    [
      "a non-boolean favorited",
      "favorited=yes",
      "Query parameter `favorited` must be `true` or `false`",
    ],
  ])(
    "returns a 400 for %s",
    async (_label: string, query: string, error: string) => {
      expect(await errorOf(parseCardsQueryOptions(get(query)))).toEqual({
        body: { code: "INVALID_INPUT", error },
        status: 400,
      });
    }
  );
});

describe("parseCardRoute", () => {
  test.each([
    ["GET", "/v1/cards/card_1", { cardId: "card_1", operation: "get" }],
    ["DELETE", "/v1/cards/card_1", { cardId: "card_1", operation: "delete" }],
    ["PATCH", "/v1/cards/card_1", { cardId: "card_1", operation: "patch" }],
    [
      "PATCH",
      "/v1/cards/card_1/favorite",
      { cardId: "card_1", operation: "favorite" },
    ],
  ] as const)("routes %s %s", (method, path, expected) => {
    expect(parseCardRoute(new Request(`${API}${path}`, { method }))).toEqual(
      expected
    );
  });

  test.each([
    ["POST", "/v1/cards/card_1"],
    ["GET", "/v1/cards/card_1/favorite"],
    ["PATCH", "/v1/cards/card_1/unknown"],
    ["GET", "/v2/cards/card_1"],
    ["GET", "/v1/cards"],
  ])("does not route %s %s", (method: string, path: string) => {
    expect(parseCardRoute(new Request(`${API}${path}`, { method }))).toBeNull();
  });
});

test.each(["style", "hue", "hex"])(
  "rejects excessive %s filters instead of silently truncating",
  async (dimension: "style" | "hue" | "hex") => {
    const params = new URLSearchParams();
    for (let index = 0; index < 25; index += 1) {
      const value = {
        style: "minimal",
        hue: "blue",
        hex: `#${index.toString(16).padStart(6, "0")}`,
      }[dimension];
      params.append(dimension, value ?? "");
    }
    expect(
      await errorOf(parseCardsQueryOptions(get(params.toString())))
    ).toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
  }
);
