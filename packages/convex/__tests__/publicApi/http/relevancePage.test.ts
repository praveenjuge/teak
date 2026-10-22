import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

let ensured: { outcome: string; scores: unknown[] | null };
let ensureCalls = 0;
let relevanceForPage: any;

const cursor = (ranked: boolean) =>
  btoa(JSON.stringify({ mode: "relevance", offset: 1, ranked }));

beforeAll(async () => {
  const actual = await import("../../../search/relevanceActions");
  mock.module(import.meta.resolve("../../../search/relevanceActions"), () => ({
    ...actual,
    ensureRelevanceScores: () => {
      ensureCalls += 1;
      return Promise.resolve(ensured);
    },
  }));
  ({ relevanceForPage } = await import("../../../publicApi/http/cards"));
});

beforeEach(() => {
  ensureCalls = 0;
  ensured = {
    outcome: "ok",
    scores: [{ cardId: "a", score: 3, cardUpdatedAt: 1 }],
  };
});

const ctx = { runQuery: () => Promise.resolve({ items: [] }) };
const page = (pageCursor?: string) =>
  relevanceForPage(ctx, {
    candidateArgs: {},
    cursor: pageCursor,
    spentToken: false,
    text: "soup",
    userId: "teak_user",
  });

describe("relevanceForPage", () => {
  test("a first page is scored when every candidate got a score", async () => {
    expect(await page()).toEqual({ scores: ensured.scores });
  });

  test("a first page that couldn't be scored stays unscored", async () => {
    ensured = { outcome: "rate_limited", scores: null };
    expect(await page()).toEqual({});
  });

  test("an unscored pagination never asks Clef again", async () => {
    expect(await page(cursor(false))).toEqual({});
    expect(ensureCalls).toBe(0);
  });

  test("a scored pagination keeps its scores", async () => {
    ensured = { outcome: "rate_limited", scores: ensured.scores };
    expect(await page(cursor(true))).toEqual({ scores: ensured.scores });
  });

  test("a scored pagination whose scores are gone is refused", async () => {
    ensured = { outcome: "skipped", scores: null };
    await expect(page(cursor(true))).rejects.toThrow("expired");
  });
});
