// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { resetSaveToTeakTokenCache, saveToTeak } from "../../lib/saveToTeak";

describe("saveToTeak", () => {
  beforeEach(() => {
    resetSaveToTeakTokenCache();
    // The token exchange URL is built from the Convex site URL.
    process.env.VITE_PUBLIC_CONVEX_SITE_URL = "https://test.convex.site";
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

  test("clears the local session and returns unauthenticated on a 401 token exchange", async () => {
    const remove = mock(async () => {
      // no-op storage stub
    });
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {
            // no-op
          },
          remove,
        },
      },
    };

    try {
      const result = await saveToTeak(
        {
          content: "https://x.com/teak/status/123",
          enforceAllowedHosts: true,
          source: "inline-post",
        },
        {
          getSessionToken: async () => "stale_token",
          fetchImpl: mock(
            async () => new Response("", { status: 401 })
          ) as unknown as typeof fetch,
        }
      );

      expect(result.status).toBe("unauthenticated");
      // clearLocalSession removed the stored token + pending flow.
      expect(remove).toHaveBeenCalled();
    } finally {
      (globalThis as any).chrome = undefined;
    }
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

  test("preserves selected Markdown exactly for text cards", async () => {
    const query = mock(async () => null);
    const mutation = mock(async () => "card_markdown");
    const content = "\uFEFF  # Heading\r\n\r\n- [ ] task  \r\n";

    await saveToTeak(
      { content, source: "context-menu" },
      {
        createClient: () => ({ query, mutation }),
        fetchImpl: mock(async () =>
          Response.json({ token: "header.payload.signature" })
        ) as unknown as typeof fetch,
        getSessionToken: async () => "session_token",
      }
    );

    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      content,
      type: "text",
    });
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
          mutation: () =>
            Promise.reject(
              new Error("CARD_LIMIT_REACHED: free tier limit exceeded")
            ),
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
