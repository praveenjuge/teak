/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import { saveToTeak } from "../../lib/saveToTeak";

describe("OAuth content saving", () => {
  test.each(["context-menu", "inline-post", "popup-auto-save"] as const)(
    "saves a URL from %s and preserves its idempotency key",
    async (source) => {
      const request = mock(async (path: string, _init?: RequestInit) =>
        path.startsWith("/v1/cards/duplicate")
          ? Response.json({ cardId: null })
          : Response.json({ cardId: "saved-card" })
      );
      expect(
        await saveToTeak(
          {
            content: "https://example.com",
            source,
            idempotencyKey: "pending-save-id",
          },
          { request }
        )
      ).toEqual({ status: "saved", cardId: "saved-card" });
      expect(request.mock.calls[0]?.[0]).toBe(
        "/v1/cards/duplicate?url=https%3A%2F%2Fexample.com%2F"
      );
      const init = request.mock.calls[1]?.[1];
      expect(JSON.parse(String(init?.body))).toEqual({
        url: "https://example.com/",
      });
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(
        "pending-save-id"
      );
    }
  );
  test("preserves selected text without a duplicate lookup", async () => {
    const request = mock(async (_path: string, _init?: RequestInit) =>
      Response.json({ cardId: "text-card" })
    );
    expect(
      await saveToTeak(
        { content: "  Notes\nwith formatting  ", source: "context-menu" },
        { request }
      )
    ).toEqual({ status: "saved", cardId: "text-card" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      content: "  Notes\nwith formatting  ",
      cardType: "text",
    });
  });
  test("returns the existing card without creating a duplicate", async () => {
    const request = mock(async () =>
      Response.json({ cardId: "existing-card" })
    );
    expect(
      await saveToTeak(
        { content: "https://example.com/", source: "inline-post" },
        { request }
      )
    ).toEqual({ status: "duplicate", cardId: "existing-card" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  test("requests reconnect when its OAuth credential is absent or revoked", async () => {
    expect(
      await saveToTeak(
        { content: "Note", source: "context-menu" },
        { request: async () => null }
      )
    ).toEqual({ status: "unauthenticated" });
  });
  test("preserves API quota feedback", async () => {
    const result = await saveToTeak(
      { content: "Note", source: "context-menu" },
      {
        request: async () =>
          Response.json(
            {
              code: "CARD_LIMIT_REACHED",
              error: "Your library is full.",
            },
            { status: 403 }
          ),
      }
    );
    expect(result).toEqual({
      status: "error",
      code: "CARD_LIMIT_REACHED",
      message: "Your library is full.",
    });
  });
  test("rejects empty content and unsupported inline hosts before network access", async () => {
    const request = mock(async () => Response.json({}));
    expect(
      await saveToTeak({ content: " ", source: "context-menu" }, { request })
    ).toMatchObject({ code: "EMPTY_CONTENT" });
    expect(
      await saveToTeak(
        {
          content: "https://example.com/post/1",
          enforceAllowedHosts: true,
          source: "inline-post",
        },
        { request }
      )
    ).toMatchObject({ code: "UNSUPPORTED_HOST" });
    expect(request).not.toHaveBeenCalled();
  });
  test("does not create a card when duplicate detection fails", async () => {
    const request = mock(async () =>
      Response.json(
        { code: "RATE_LIMITED", error: "Try later" },
        { status: 429 }
      )
    );
    expect(
      await saveToTeak(
        { content: "https://example.com/", source: "context-menu" },
        { request }
      )
    ).toMatchObject({ status: "error", code: "RATE_LIMITED" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
