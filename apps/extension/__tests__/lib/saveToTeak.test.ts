// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { resetSaveToTeakTokenCache, saveToTeak } from "../../lib/saveToTeak";

describe("saveToTeak", () => {
  beforeEach(() => {
    resetSaveToTeakTokenCache();
  });

  test("returns unauthenticated when no web session token exists", async () => {
    const result = await saveToTeak(
      {
        content: "https://x.com/teak/status/123",
        enforceAllowedHosts: true,
        source: "inline-post",
      },
      {
        getSessionToken: async () => null,
      }
    );

    expect(result.status).toBe("unauthenticated");
  });

  test("fails fast on unsupported host for inline saves", async () => {
    const result = await saveToTeak(
      {
        content: "https://example.com/post/1",
        enforceAllowedHosts: true,
        source: "inline-post",
      },
      {
        getSessionToken: async () => "session_token",
      }
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("UNSUPPORTED_HOST");
    }
  });

  test("returns duplicate when an existing URL card is found", async () => {
    const query = mock(async () => ({ _id: "card_1" }));
    const mutation = mock(async () => "card_2");

    const result = await saveToTeak(
      {
        content: "https://x.com/teak/status/123",
        enforceAllowedHosts: true,
        source: "inline-post",
      },
      {
        createClient: () => ({ query, mutation }),
        fetchImpl: mock(
          async () =>
            new Response(
              JSON.stringify({ token: "header.payload.signature" }),
              {
                status: 200,
              }
            )
        ) as unknown as typeof fetch,
        getSessionToken: async () => "session_token",
      }
    );

    expect(result).toEqual({
      status: "duplicate",
      cardId: "card_1",
    });
    expect(mutation).not.toHaveBeenCalled();
  });

  test("saves article URLs when inline-host enforcement is disabled", async () => {
    const query = mock(async () => null);
    const mutation = mock(async () => "card_hn");

    const result = await saveToTeak(
      {
        content: "https://example.com/story",
        source: "inline-post",
      },
      {
        createClient: () => ({ query, mutation }),
        fetchImpl: mock(
          async () =>
            new Response(
              JSON.stringify({ token: "header.payload.signature" }),
              {
                status: 200,
              }
            )
        ) as unknown as typeof fetch,
        getSessionToken: async () => "session_token",
      }
    );

    expect(result).toEqual({
      status: "saved",
      cardId: "card_hn",
    });
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      url: "https://example.com/story",
    });
    expect(mutation).toHaveBeenCalled();
  });

  test("saves non-url content without duplicate lookup", async () => {
    const query = mock(async () => null);
    const mutation = mock(async () => "card_saved");

    const result = await saveToTeak(
      {
        content: "Some highlighted text",
        source: "context-menu",
      },
      {
        createClient: () => ({ query, mutation }),
        fetchImpl: mock(
          async () =>
            new Response(
              JSON.stringify({ token: "header.payload.signature" }),
              {
                status: 200,
              }
            )
        ) as unknown as typeof fetch,
        getSessionToken: async () => "session_token",
      }
    );

    expect(result).toEqual({
      status: "saved",
      cardId: "card_saved",
    });
    expect(query).not.toHaveBeenCalled();
  });

  test("maps card limit failures to explicit error code", async () => {
    const result = await saveToTeak(
      {
        content: "https://x.com/teak/status/123",
        enforceAllowedHosts: true,
        source: "inline-post",
      },
      {
        createClient: () => ({
          query: async () => null,
          mutation: async () => {
            throw new Error("CARD_LIMIT_REACHED: free tier limit exceeded");
          },
        }),
        fetchImpl: mock(
          async () =>
            new Response(
              JSON.stringify({ token: "header.payload.signature" }),
              {
                status: 200,
              }
            )
        ) as unknown as typeof fetch,
        getSessionToken: async () => "session_token",
      }
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("CARD_LIMIT_REACHED");
    }
  });
});
