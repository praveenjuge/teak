/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import { saveToTeak } from "../../lib/saveToTeak";
import { apiClient } from "../helpers/teakClient";

describe("OAuth content saving", () => {
  test.each(["context-menu", "inline-post", "popup-auto-save"] as const)(
    "saves a URL from %s and preserves its idempotency key",
    async (source) => {
      const request = mock(async (_path: string, _init?: RequestInit) =>
        Response.json({ status: "created", cardId: "saved-card" })
      );
      expect(
        await saveToTeak(
          {
            content: "https://example.com",
            source,
            idempotencyKey: "pending-save-id",
          },
          { client: apiClient(request) }
        )
      ).toEqual({ status: "saved", cardId: "saved-card" });
      expect(request.mock.calls.map(([path]) => path)).toEqual(["/v1/cards"]);
      const init = request.mock.calls[0]?.[1];
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
      Response.json({ status: "created", cardId: "text-card" })
    );
    expect(
      await saveToTeak(
        { content: "  Notes\nwith formatting  ", source: "context-menu" },
        { client: apiClient(request) }
      )
    ).toEqual({ status: "saved", cardId: "text-card" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      content: "  Notes\nwith formatting  ",
      cardType: "text",
    });
  });
  test("keeps the page a text selection came from", async () => {
    const request = mock(async (_path: string, _init?: RequestInit) =>
      Response.json({ status: "created", cardId: "text-card" })
    );
    await saveToTeak(
      {
        content: "A line worth keeping",
        source: "context-menu",
        sourceTitle: `  ${"t".repeat(320)}  `,
        sourceUrl: "https://example.com/essay",
      },
      { client: apiClient(request) }
    );
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      cardType: "text",
      content: "A line worth keeping",
      sourceTitle: "t".repeat(300),
      sourceUrl: "https://example.com/essay",
    });
  });
  test("a selection that is a bare URL saves as a link, with no source", async () => {
    const request = mock(async (_path: string, _init?: RequestInit) =>
      Response.json({ status: "created", cardId: "link-card" })
    );
    await saveToTeak(
      {
        content: "https://example.org/linked",
        source: "context-menu",
        sourceTitle: "Where it was",
        sourceUrl: "https://example.com/page",
      },
      { client: apiClient(request) }
    );
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      url: "https://example.org/linked",
    });
  });
  test.each([
    "chrome://extensions",
    "javascript:alert(1)",
    `https://example.com/${"a".repeat(2100)}`,
  ])("leaves out a source page it can't keep: %p", async (sourceUrl) => {
    const request = mock(async (_path: string, _init?: RequestInit) =>
      Response.json({ status: "created", cardId: "text-card" })
    );
    await saveToTeak(
      { content: "Quote", source: "context-menu", sourceUrl },
      { client: apiClient(request) }
    );
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      cardType: "text",
      content: "Quote",
    });
  });
  test("a selection that only starts with a URL saves as text", async () => {
    const request = mock(async (_path: string, _init?: RequestInit) =>
      Response.json({ status: "created", cardId: "text-card" })
    );
    await saveToTeak(
      {
        content: "https://github.com/teak/app is the repo\nwith notes",
        source: "context-menu",
        sourceUrl: "https://example.com/essay",
      },
      { client: apiClient(request) }
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      cardType: "text",
      content: "https://github.com/teak/app is the repo\nwith notes",
      sourceUrl: "https://example.com/essay",
    });
  });
  test.each([{ resaved: true }, { resaved: true, wasArchived: true }])(
    "a link already in Teak is saved again and shows as already in Teak: %p",
    async (outcome) => {
      const request = mock(async (_path: string, _init?: RequestInit) =>
        Response.json({
          status: "created",
          cardId: "existing-card",
          ...outcome,
        })
      );
      expect(
        await saveToTeak(
          { content: "https://example.com/", source: "inline-post" },
          { client: apiClient(request) }
        )
      ).toEqual({ status: "duplicate", cardId: "existing-card" });
      expect(request.mock.calls.map(([path]) => path)).toEqual(["/v1/cards"]);
      expect(request.mock.calls[0]?.[1]?.method).toBe("POST");
    }
  );
  test("requests reconnect when its OAuth credential is absent or revoked", async () => {
    expect(
      await saveToTeak(
        { content: "Note", source: "context-menu" },
        { client: apiClient(async () => null) }
      )
    ).toEqual({ status: "unauthenticated" });
  });
  test("preserves API quota feedback", async () => {
    const result = await saveToTeak(
      { content: "Note", source: "context-menu" },
      {
        client: apiClient(async () =>
          Response.json(
            {
              code: "CARD_LIMIT_REACHED",
              error: "Your library is full.",
            },
            { status: 403 }
          )
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
      await saveToTeak(
        { content: " ", source: "context-menu" },
        { client: apiClient(request) }
      )
    ).toMatchObject({ code: "EMPTY_CONTENT" });
    expect(
      await saveToTeak(
        {
          content: "https://example.com/post/1",
          enforceAllowedHosts: true,
          source: "inline-post",
        },
        { client: apiClient(request) }
      )
    ).toMatchObject({ code: "UNSUPPORTED_HOST" });
    expect(request).not.toHaveBeenCalled();
  });
  test("marks a save that never reached Teak as a network failure", async () => {
    expect(
      await saveToTeak(
        { content: "Note", source: "context-menu" },
        {
          client: apiClient(() =>
            Promise.reject(new TypeError("Failed to fetch"))
          ),
        }
      )
    ).toEqual({
      status: "error",
      code: "NETWORK_ERROR",
      message: "Couldn't reach Teak. Check your connection and try again.",
    });
  });
  test("reports a refused link save", async () => {
    const request = mock(async () =>
      Response.json(
        { code: "RATE_LIMITED", error: "Try later" },
        { status: 429 }
      )
    );
    expect(
      await saveToTeak(
        { content: "https://example.com/", source: "context-menu" },
        { client: apiClient(request) }
      )
    ).toMatchObject({ status: "error", code: "RATE_LIMITED" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
