import { describe, expect, test } from "bun:test";
import {
  CARD_LIST_PARAMS,
  matchPublicApiOperation,
  PUBLIC_API_OPERATION_IDS,
  PUBLIC_API_OPERATIONS,
  publicApiEndpointLabel,
  publicApiMethodsFor,
  publicApiPath,
  publicApiPathParams,
  SEARCH_QUERY_HELP,
} from "../../shared/publicApiContract";
import {
  SEARCH_IS_WORDS,
  SEARCH_QUALIFIER_KEYS,
} from "../../shared/search/qualifiers";

describe("matchPublicApiOperation", () => {
  test.each([
    ["GET", "/v1/cards/card_1", "getCard", { cardId: "card_1" }],
    ["DELETE", "/v1/cards/card_1", "deleteCard", { cardId: "card_1" }],
    ["PATCH", "/v1/cards/card_1", "updateCard", { cardId: "card_1" }],
    [
      "PATCH",
      "/v1/cards/card_1/favorite",
      "setCardFavorite",
      { cardId: "card_1" },
    ],
    ["POST", "/v1/cards/card_1/done", "markCardDone", { cardId: "card_1" }],
    ["DELETE", "/v1/cards/card_1/done", "unmarkCardDone", { cardId: "card_1" }],
    [
      "POST",
      "/v1/cards/card_1/thumbnail/upload",
      "createThumbnailUpload",
      { cardId: "card_1" },
    ],
    [
      "POST",
      "/v1/folders/f1/rule-runs/r1/undo",
      "undoFolderRuleRun",
      { folderId: "f1", runId: "r1" },
    ],
    ["GET", "/v1/cards/changes", "listCardChanges", {}],
    ["GET", "/v1/cards/duplicate", "findDuplicateCard", {}],
    ["PUT", "/v1/cards/pinned/order", "reorderPinnedCards", {}],
    ["GET", "/v1/cards/a%2Fb", "getCard", { cardId: "a/b" }],
  ] as const)("routes %s %s to %s", (method, path, operationId, params) => {
    expect(matchPublicApiOperation(method, path)).toEqual({
      operationId,
      params,
    });
  });

  test.each([
    ["POST", "/v1/cards/card_1"],
    ["GET", "/v1/cards/card_1/favorite"],
    ["PATCH", "/v1/cards/card_1/unknown"],
    ["GET", "/v2/cards/card_1"],
    ["GET", "/v1/cards/"],
    ["GET", "/v1/cards/card_1/extra/more"],
    ["GET", "/v1/cards/%E0%A4%A"],
  ])("does not route %s %s", (method, path) => {
    expect(matchPublicApiOperation(method, path)).toBeNull();
  });

  test("every operation's own path routes back to it", () => {
    for (const id of PUBLIC_API_OPERATION_IDS) {
      const params = Object.fromEntries(
        publicApiPathParams(id).map((name) => [name, `${name}_1`])
      );
      expect({
        id,
        match: matchPublicApiOperation(
          PUBLIC_API_OPERATIONS[id].method,
          publicApiPath(id, params)
        ),
      }).toEqual({ id, match: { operationId: id, params } });
    }
  });
});

describe("publicApiPath", () => {
  test("encodes each path parameter", () => {
    expect(publicApiPath("getCard", { cardId: "../me" })).toBe(
      "/v1/cards/..%2Fme"
    );
    expect(
      publicApiPath("getFolderRuleRun", { folderId: "f 1", runId: "r1" })
    ).toBe("/v1/folders/f%201/rule-runs/r1");
  });

  test("refuses a missing parameter", () => {
    expect(() => publicApiPath("getCard")).toThrow("cardId");
  });
});

test("publicApiMethodsFor lists the methods served on a path", () => {
  expect(publicApiMethodsFor("/v1/cards")).toEqual(["GET", "POST"]);
  expect(publicApiMethodsFor("/v1/cards/c1")).toEqual([
    "GET",
    "PATCH",
    "DELETE",
  ]);
  expect(publicApiMethodsFor("/v1/cards/c1/done")).toEqual(["POST", "DELETE"]);
  expect(publicApiMethodsFor("/v1/highlights/h1/extra")).toEqual([]);
});

test("a written-out path is never read as a template, whatever the method", () => {
  expect(matchPublicApiOperation("PATCH", "/v1/cards/changes")).toBeNull();
  expect(matchPublicApiOperation("DELETE", "/v1/cards/bulk")).toBeNull();
  expect(publicApiMethodsFor("/v1/cards/changes")).toEqual(["GET"]);
  expect(publicApiMethodsFor("/v1/cards/bulk")).toEqual(["POST"]);
  expect(publicApiMethodsFor("/v1/cards/pinned/order")).toEqual(["PUT"]);
});

test("publicApiEndpointLabel writes path parameters the way GET /v1 lists them", () => {
  expect(publicApiEndpointLabel("getFolderRuleRun")).toBe(
    "GET /v1/folders/:folderId/rule-runs/:runId"
  );
});

test("listCards documents exactly the card list parameters", async () => {
  const { openApiSpec } = await import("../../publicApi/openApi/spec");
  const listCards = openApiSpec.paths["/v1/cards"]?.get as
    | { parameters: { name: string }[] }
    | undefined;
  const parameters = (listCards?.parameters ?? []).map(
    (parameter) => parameter.name
  );
  expect([...parameters].sort()).toEqual(Object.keys(CARD_LIST_PARAMS).sort());
});

test("the search help names every qualifier and is: value the parser reads", () => {
  const missing = [
    ...SEARCH_QUALIFIER_KEYS.map((key) => `${key}:`),
    ...Object.keys(SEARCH_IS_WORDS).map((value) => `is:${value}`),
  ].filter((qualifier) => !SEARCH_QUERY_HELP.includes(qualifier));
  expect(missing).toEqual([]);
});

test("every enum parameter lists its values and keeps its default among them", () => {
  for (const [name, spec] of Object.entries(CARD_LIST_PARAMS)) {
    const { values, default: fallback } = spec as {
      default?: number | string;
      values?: readonly string[];
    };
    if (spec.kind === "enum") {
      expect({ name, values: (values ?? []).length > 0 }).toEqual({
        name,
        values: true,
      });
    }
    if (typeof fallback === "string") {
      expect({ name, listed: values?.includes(fallback) }).toEqual({
        name,
        listed: true,
      });
    }
  }
});
