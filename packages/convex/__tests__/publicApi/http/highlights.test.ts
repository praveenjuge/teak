import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import {
  cardByIdV1,
  executePublicApiOperation,
  highlightByIdV1,
} from "../../../publicApi/http/routes";
import { mockActionCtx } from "../../helpers/convex.test-utils";
import {
  buildAuthorizedMutationMock,
  runHandler,
} from "../../helpers/publicApiHttp.test-utils";
import { withMappedOwner } from "../../helpers/session.test-utils";

const TOKEN = `teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;
const ARTICLE = [
  "# Gardens",
  "",
  "Plant **marigolds** around the tomatoes. Water in the morning.",
  "",
  "In summer, water in the morning again.",
].join("\n");

const sha256 = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");

const request = (method: string, path: string, body?: unknown) =>
  new Request(`https://example.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const row = (overrides: Record<string, unknown> = {}) => ({
  _id: "highlight_1",
  _creationTime: 1,
  userId: "user_1",
  cardId: "card_1",
  quote: "Water in the morning.",
  start: 50,
  end: 71,
  source: "api",
  createdAt: 10,
  updatedAt: 11,
  ...overrides,
});

const nameOf = (ref: unknown) => getFunctionName(ref as never);

let originalFetch: typeof fetch;
const env = { ...process.env };
beforeEach(() => {
  originalFetch = global.fetch;
  process.env.FILES_BASE = "https://files.test";
  process.env.FILES_SIGNING_SECRET = "test-secret";
});
afterEach(() => {
  global.fetch = originalFetch;
  process.env.FILES_BASE = env.FILES_BASE;
  process.env.FILES_SIGNING_SECRET = env.FILES_SIGNING_SECRET;
});

const articleSource = async () => ({
  cardId: "card_1",
  imageCount: 0,
  textKey: `users/u1/cards/card1/article-text/r1-${await sha256(ARTICLE)}.md`,
  title: "Gardens",
});

describe("POST /v1/cards/{cardId}/highlights", () => {
  test("finds the quote in the article as the reader shows it, and creates it", async () => {
    global.fetch = mock(() => Promise.resolve(new Response(ARTICLE))) as never;
    const runQuery = mock().mockResolvedValueOnce(await articleSource());
    const runMutation = buildAuthorizedMutationMock().mockResolvedValueOnce({
      created: true,
      merged: false,
      highlight: row({ note: "Early" }),
    });
    const response = await runHandler(
      cardByIdV1,
      { runMutation, runQuery },
      request("POST", "/v1/cards/card_1/highlights", {
        quote: "water  in the\nmorning",
        suffix: " again.",
        note: "Early",
      })
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: "highlight_1",
      cardId: "card_1",
      quote: "Water in the morning.",
      note: "Early",
      anchored: true,
      source: "api",
      createdAt: 10,
      updatedAt: 11,
    });
    const [ref, args] = runMutation.mock.calls[1] ?? [];
    expect(nameOf(ref)).toBe("publicApiHighlights:createHighlightForApi");
    // The reader's text drops the title heading and the bold markers; the
    // suffix picks the second "water in the morning".
    const text =
      "Plant marigolds around the tomatoes. Water in the morning. In summer, water in the morning again.";
    const start = text.lastIndexOf("water in the morning");
    expect(args).toMatchObject({
      userId: "user_1",
      cardId: "card_1",
      // The text the quote was found in, so a replaced article refuses it.
      articleKey: (await articleSource()).textKey,
      quote: "water in the morning",
      start,
      end: start + "water in the morning".length,
      suffix: " again.",
      note: "Early",
    });
  });

  test("a merge or a passage highlighted already answers 200", async () => {
    global.fetch = mock(() => Promise.resolve(new Response(ARTICLE))) as never;
    const response = await runHandler(
      cardByIdV1,
      {
        runMutation: buildAuthorizedMutationMock().mockResolvedValueOnce({
          created: false,
          merged: true,
          highlight: row(),
        }),
        runQuery: mock().mockResolvedValueOnce(await articleSource()),
      },
      request("POST", "/v1/cards/card_1/highlights", { quote: "marigolds" })
    );
    expect(response.status).toBe(200);
  });

  test("a quote the article doesn't have is 422 QUOTE_NOT_FOUND", async () => {
    global.fetch = mock(() => Promise.resolve(new Response(ARTICLE))) as never;
    const runMutation = buildAuthorizedMutationMock();
    const response = await runHandler(
      cardByIdV1,
      {
        runMutation,
        runQuery: mock().mockResolvedValueOnce(await articleSource()),
      },
      request("POST", "/v1/cards/card_1/highlights", { quote: "tulips" })
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "QUOTE_NOT_FOUND" });
    expect(runMutation.mock.calls).toHaveLength(1);
  });

  test.each([
    ["NO_ARTICLE", 409],
    ["NOT_FOUND", 404],
  ])("%s from the card answers %i", async (code, status) => {
    const response = await runHandler(
      cardByIdV1,
      {
        runMutation: buildAuthorizedMutationMock(),
        runQuery: mock().mockRejectedValueOnce(
          new ConvexError({ code, message: "No" })
        ),
      },
      request("POST", "/v1/cards/card_1/highlights", { quote: "marigolds" })
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  });

  test("HIGHLIGHT_LIMIT from the write answers 409", async () => {
    global.fetch = mock(() => Promise.resolve(new Response(ARTICLE))) as never;
    const response = await runHandler(
      cardByIdV1,
      {
        runMutation: buildAuthorizedMutationMock().mockRejectedValueOnce(
          new ConvexError({ code: "HIGHLIGHT_LIMIT", message: "Full" })
        ),
        runQuery: mock().mockResolvedValueOnce(await articleSource()),
      },
      request("POST", "/v1/cards/card_1/highlights", { quote: "marigolds" })
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "HIGHLIGHT_LIMIT" });
  });

  test.each([
    [{}, "quote"],
    [{ quote: "   " }, "quote"],
    [{ quote: "x".repeat(5001) }, "5,000"],
    [{ quote: "x", note: "n".repeat(2001) }, "2,000"],
    [{ quote: "x", prefix: 4 }, "prefix"],
  ])("refuses %j before any read", async (body, message) => {
    const runQuery = mock();
    const response = await runHandler(
      cardByIdV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      request("POST", "/v1/cards/card_1/highlights", body)
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(message);
    expect(runQuery.mock.calls).toHaveLength(0);
  });
});

describe("the other highlight operations", () => {
  test("GET lists a card's highlights", async () => {
    const runQuery = mock().mockResolvedValueOnce([
      row(),
      row({ _id: "highlight_2", unanchored: true, source: "import" }),
    ]);
    const response = await runHandler(
      cardByIdV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery },
      request("GET", "/v1/cards/card_1/highlights")
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.items.map((item: { anchored: boolean }) => item.anchored)
    ).toEqual([true, false]);
    expect(nameOf(runQuery.mock.calls[0]?.[0])).toBe(
      "publicApiHighlights:listHighlightsForApi"
    );
  });

  test("PATCH clears a note with null", async () => {
    const runMutation = buildAuthorizedMutationMock().mockResolvedValueOnce(
      row()
    );
    const response = await runHandler(
      highlightByIdV1,
      { runMutation, runQuery: mock() },
      request("PATCH", "/v1/highlights/highlight_1", { note: null })
    );
    expect(response.status).toBe(200);
    expect(runMutation.mock.calls[1]?.[1]).toEqual({
      userId: "user_1",
      highlightId: "highlight_1",
      note: null,
    });
  });

  test("PATCH without a note is 400", async () => {
    const response = await runHandler(
      highlightByIdV1,
      { runMutation: buildAuthorizedMutationMock(), runQuery: mock() },
      request("PATCH", "/v1/highlights/highlight_1", { text: "x" })
    );
    expect(response.status).toBe(400);
  });

  test("DELETE answers 204, and another account's highlight 404", async () => {
    const deleted = await runHandler(
      highlightByIdV1,
      {
        runMutation: buildAuthorizedMutationMock().mockResolvedValueOnce(null),
        runQuery: mock(),
      },
      request("DELETE", "/v1/highlights/highlight_1")
    );
    expect(deleted.status).toBe(204);
    const missing = await runHandler(
      highlightByIdV1,
      {
        runMutation: buildAuthorizedMutationMock().mockRejectedValueOnce(
          new ConvexError({ code: "NOT_FOUND", message: "Highlight not found" })
        ),
        runQuery: mock(),
      },
      request("DELETE", "/v1/highlights/highlight_9")
    );
    expect(missing.status).toBe(404);
  });

  test("MCP, SDK and CLI reach the routes through executePublicApiOperation", async () => {
    const runQuery = mock().mockResolvedValueOnce([]);
    const response = await executePublicApiOperation(
      mockActionCtx(
        withMappedOwner({
          runMutation: buildAuthorizedMutationMock(),
          runQuery,
        } as never)
      ),
      {
        method: "GET",
        path: "/v1/cards/card_1/highlights",
        headers: { Authorization: `Bearer ${TOKEN}` },
      }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
  });
});
