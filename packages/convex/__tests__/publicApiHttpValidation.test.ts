import { describe, expect, test } from "bun:test";
import {
  parseCardRoute,
  parseCardsQueryOptions,
  parseIncludeSet,
  validateCreatePayload,
  validateFavoritePayload,
  validatePatchPayload,
  validateUploadPayload,
} from "../publicApiHttpValidation";

// Requests reach the Convex HTTP router at /v1/... (the /api prefix is the
// public proxy path).
const API = "https://teak.convex.site";
const get = (query: string) => new Request(`${API}/v1/cards?${query}`);

const errorOf = async (result: unknown) => {
  expect(result).toBeInstanceOf(Response);
  const response = result as Response;
  return { body: await response.json(), status: response.status };
};

describe("validateCreatePayload", () => {
  test("accepts a text card and keeps notes, tags and source", () => {
    expect(
      validateCreatePayload({
        content: "Remember this",
        notes: "from a meeting",
        source: "cli",
        tags: [" design ", "design", "", "ideas"],
      })
    ).toEqual({
      cardType: undefined,
      content: "Remember this",
      notes: "from a meeting",
      source: "cli",
      tags: ["design", "ideas"],
      url: undefined,
    });
  });

  test("accepts a link card with only a url", () => {
    expect(validateCreatePayload({ url: "https://example.com" })).toMatchObject(
      { url: "https://example.com" }
    );
  });

  test("accepts an uploaded file card that names its file", () => {
    expect(
      validateCreatePayload({
        fileKey: "uploads/abc",
        fileName: "report.pdf",
        fileSize: 2048,
        mimeType: "application/pdf",
      })
    ).toMatchObject({
      fileKey: "uploads/abc",
      fileName: "report.pdf",
      fileSize: 2048,
      mimeType: "application/pdf",
    });
  });

  test.each([
    ["a non-object body", "hello"],
    ["an array body", [{ content: "x" }]],
    ["null", null],
    ["an unknown field", { content: "x", color: "red" }],
    ["a non-string content", { content: 42 }],
    ["no content and no url", { notes: "only notes" }],
    ["blank content on a non-text card", { cardType: "quote", content: "  " }],
    ["an unknown card type", { cardType: "spreadsheet", content: "x" }],
    ["a javascript: url", { url: "javascript:alert(1)" }],
    ["tags that are not strings", { content: "x", tags: ["ok", 1] }],
    ["a non-numeric file size", { content: "x", fileSize: "big" }],
    ["file fields without a fileKey", { content: "x", fileName: "a.pdf" }],
    [
      "a fileKey without a file name",
      { fileKey: "uploads/abc", mimeType: "application/pdf" },
    ],
    [
      "a fileKey together with a url",
      {
        fileKey: "uploads/abc",
        fileName: "a.pdf",
        mimeType: "application/pdf",
        url: "https://example.com",
      },
    ],
    ["numeric notes", { content: "x", notes: 5 }],
  ])("rejects %s", (_label: string, payload: unknown) => {
    expect(validateCreatePayload(payload)).toBeNull();
  });
});

describe("validateUploadPayload", () => {
  test("accepts a named file with a size and type", () => {
    expect(
      validateUploadPayload({
        fileName: "clip.mp4",
        fileSize: 10,
        mimeType: "video/mp4",
      })
    ).toEqual({ fileName: "clip.mp4", fileSize: 10, mimeType: "video/mp4" });
  });

  test.each([
    ["a missing size", { fileName: "a.png", mimeType: "image/png" }],
    [
      "a string size",
      { fileName: "a.png", fileSize: "10", mimeType: "image/png" },
    ],
    ["a missing type", { fileName: "a.png", fileSize: 10 }],
    [
      "an extra field",
      { fileName: "a.png", fileSize: 10, mimeType: "image/png", url: "x" },
    ],
  ])("rejects %s", (_label: string, payload: unknown) => {
    expect(validateUploadPayload(payload)).toBeNull();
  });
});

describe("validatePatchPayload", () => {
  test("normalizes editable titles and preserves old patch payloads", () => {
    expect(validatePatchPayload({ metadataTitle: "  New title  " })).toEqual({
      metadataTitle: "New title",
    });
    expect(validatePatchPayload({ metadataTitle: null })).toEqual({
      metadataTitle: null,
    });
    expect(validatePatchPayload({ metadataTitle: "  " })).toEqual({
      metadataTitle: null,
    });
    expect(validatePatchPayload({ notes: " note " })).toEqual({
      notes: "note",
    });
    expect(
      validatePatchPayload({ metadataTitle: "x".repeat(512) })?.metadataTitle
    ).toHaveLength(512);
  });

  test.each(
    [42, true, [], {}, "x".repeat(513)].map((metadataTitle) => ({
      metadataTitle,
    }))
  )(
    "rejects invalid title %j",
    ({ metadataTitle }: { metadataTitle: unknown }) => {
      expect(validatePatchPayload({ metadataTitle })).toBeNull();
    }
  );

  test("trims the url and turns blank notes into a cleared note", () => {
    expect(
      validatePatchPayload({
        notes: "   ",
        tags: ["a", "a", " b "],
        url: "  https://example.com/x  ",
      })
    ).toEqual({ notes: null, tags: ["a", "b"], url: "https://example.com/x" });
  });

  test("allows clearing notes with null", () => {
    expect(validatePatchPayload({ notes: null })).toEqual({ notes: null });
  });

  test.each([
    ["an empty patch", {}],
    ["an unknown field", { title: "x" }],
    ["a blank url", { url: "   " }],
    ["an unsafe url", { url: "file:///etc/passwd" }],
    ["non-string content", { content: ["x"] }],
    ["non-array tags", { tags: "design" }],
  ])("rejects %s", (_label: string, payload: unknown) => {
    expect(validatePatchPayload(payload)).toBeNull();
  });
});

describe("validateFavoritePayload", () => {
  test("accepts exactly an isFavorited boolean", () => {
    expect(validateFavoritePayload({ isFavorited: true })).toEqual({
      isFavorited: true,
    });
  });

  test.each([
    ["a string flag", { isFavorited: "true" }],
    ["an extra field", { isFavorited: true, note: "x" }],
    ["an empty body", {}],
  ])("rejects %s", (_label: string, payload: unknown) => {
    expect(validateFavoritePayload(payload)).toBeNull();
  });
});

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
  test.each(["trashed=yes", "style=unknown", "hue=unknown", "hex=badhex"])(
    "rejects invalid filter %s",
    (query: string) => {
      const result = parseCardsQueryOptions(get(query));
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(400);
    }
  );
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
      showTrashOnly: false,
      styleFilters: undefined,
      hueFilters: undefined,
      hexFilters: undefined,
      limit: 100,
      searchQuery: "design",
      sort: "oldest",
      tag: "ideas",
      type: "link",
      types: undefined,
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
      "Query parameter `sort` must be `newest` or `oldest`",
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
  ])("routes %s %s", (method: string, path: string, expected: unknown) => {
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
