import { describe, expect, test } from "bun:test";
import {
  accountDeletionInstanceId,
  cardProcessingInstanceId,
  exportInstanceId,
  importInstanceId,
  isWorkflowInstanceId,
  normalizeConvexSiteUrl,
  parseConvexSiteUrls,
  parseWorkflowRpcRequest,
} from "./workflows";

// A real-shaped Convex document ID.
const CARD_ID = "jd7f2kz9m8w6y1v3h4n5q0r8s2t6u4x1";

describe("parseWorkflowRpcRequest", () => {
  test("accepts a query, mutation or action by name", () => {
    expect(
      parseWorkflowRpcRequest({
        args: { cardId: CARD_ID },
        kind: "query",
        name: "ai/queries:getCardForAI",
      })
    ).toEqual({
      args: { cardId: CARD_ID },
      kind: "query",
      name: "ai/queries:getCardForAI",
    });
  });

  test("accepts a guard on a mutation", () => {
    expect(
      parseWorkflowRpcRequest({
        args: {},
        guard: { cardId: CARD_ID, rev: 3 },
        kind: "mutation",
        name: "ai/mutations:updateCardProcessing",
      })?.guard
    ).toEqual({ cardId: CARD_ID, rev: 3 });
  });

  test.each([
    [
      "a guard on a query",
      {
        args: {},
        guard: { cardId: CARD_ID, rev: 1 },
        kind: "query",
        name: "a:b",
      },
    ],
    [
      "a fractional revision",
      {
        args: {},
        guard: { cardId: CARD_ID, rev: 1.5 },
        kind: "mutation",
        name: "a:b",
      },
    ],
    ["an unknown kind", { args: {}, kind: "httpAction", name: "a:b" }],
    ["a name without an export", { args: {}, kind: "query", name: "cards" }],
    ["a name with spaces", { args: {}, kind: "query", name: "a b:c" }],
    ["missing args", { kind: "query", name: "a:b" }],
    ["an array", [{ args: {}, kind: "query", name: "a:b" }]],
  ])("rejects %s", (_label, value) => {
    expect(parseWorkflowRpcRequest(value)).toBeNull();
  });
});

describe("Convex site URLs", () => {
  test.each([
    ["https://a.convex.site", "https://a.convex.site"],
    ["https://a.convex.site/", "https://a.convex.site"],
    ["http://127.0.0.1:3211", "http://127.0.0.1:3211"],
    ["https://a.convex.site/path", null],
    ["https://user:pass@a.convex.site", null],
    ["https://a.convex.site?x=1", null],
    ["ftp://a.convex.site", null],
    ["not a url", null],
  ])("normalizes %p to %p", (value, expected) => {
    expect(normalizeConvexSiteUrl(value)).toBe(expected);
  });

  test("lists each valid origin once, in order", () => {
    expect(
      parseConvexSiteUrls(
        " https://a.convex.site , https://b.convex.site/,bogus,https://a.convex.site"
      )
    ).toEqual(["https://a.convex.site", "https://b.convex.site"]);
    expect(parseConvexSiteUrls(undefined)).toEqual([]);
  });
});

describe("instance IDs", () => {
  test("every derived ID is one Cloudflare accepts", () => {
    for (const id of [
      cardProcessingInstanceId(CARD_ID, 12),
      exportInstanceId(CARD_ID),
      importInstanceId(CARD_ID),
      accountDeletionInstanceId(CARD_ID, 3, 2),
    ]) {
      expect(isWorkflowInstanceId(id)).toBe(true);
    }
  });

  test.each([
    ["a colon", "card:abc:1"],
    ["a leading dash", "-card"],
    ["more than 100 characters", "a".repeat(101)],
  ])("rejects an ID with %s", (_label, id) => {
    expect(isWorkflowInstanceId(id)).toBe(false);
  });
});
