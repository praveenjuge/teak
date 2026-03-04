import { afterEach, describe, expect, mock, test } from "bun:test";
import app from "./index";

type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: number;
  result: {
    tools?: Array<{ name: string }>;
    structuredContent?: Record<string, unknown>;
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
};

const originalFetch = globalThis.fetch;
const originalEnv = process.env.CONVEX_HTTP_BASE_URL;
const CONVEX_BASE_URL = "https://example.convex.site";
const MCP_AUTH_CHECK_URL = `${CONVEX_BASE_URL}/v1/cards/search?limit=1`;

const mcpRequest = async (
  body: Record<string, unknown>,
  options?: {
    path?: "/mcp" | "/mcp/";
    authorization?: string;
  }
): Promise<Response> => {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
  });

  if (options?.authorization !== undefined) {
    headers.set("Authorization", options.authorization);
  }

  return app.request(options?.path ?? "/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

const initializeMcp = async (options?: {
  path?: "/mcp" | "/mcp/";
  authorization?: string;
}) => {
  return mcpRequest(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "teak-api-tests",
          version: "1.0.0",
        },
      },
    },
    options
  );
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.CONVEX_HTTP_BASE_URL = originalEnv;
});

describe("apps/api MCP endpoint", () => {
  test("returns 401 for missing authorization", async () => {
    const response = await initializeMcp();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      error: "Missing or invalid Authorization header",
    });
  });

  test("returns 401 for malformed authorization scheme", async () => {
    const response = await initializeMcp({
      authorization: "Token teakapi_test",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      error: "Missing or invalid Authorization header",
    });
  });

  test("returns 401 for invalid API key on MCP control methods", async () => {
    process.env.CONVEX_HTTP_BASE_URL = CONVEX_BASE_URL;

    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          code: "INVALID_API_KEY",
          error: "Invalid or revoked API key",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as unknown as typeof fetch;

    const initializeResponse = await initializeMcp({
      authorization: "Bearer teakapi_invalid",
    });
    expect(initializeResponse.status).toBe(401);
    expect(await initializeResponse.json()).toEqual({
      code: "INVALID_API_KEY",
      error: "Invalid or revoked API key",
    });

    const listResponse = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
      { authorization: "Bearer teakapi_invalid" }
    );
    expect(listResponse.status).toBe(401);
    expect(await listResponse.json()).toEqual({
      code: "INVALID_API_KEY",
      error: "Invalid or revoked API key",
    });
  });

  test("supports /mcp and /mcp/ paths", async () => {
    const authorization = "Bearer teakapi_supports";
    process.env.CONVEX_HTTP_BASE_URL = CONVEX_BASE_URL;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const response = await initializeMcp({
      authorization,
      path: "/mcp/",
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as JsonRpcSuccess;
    expect(payload.result).toBeDefined();
  });

  test("initializes and lists the six teak_v1 tools", async () => {
    const authorization = "Bearer teakapi_list";
    process.env.CONVEX_HTTP_BASE_URL = CONVEX_BASE_URL;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const initResponse = await initializeMcp({
      authorization,
    });

    expect(initResponse.status).toBe(200);

    const listResponse = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
      { authorization }
    );

    expect(listResponse.status).toBe(200);
    const payload = (await listResponse.json()) as JsonRpcSuccess;
    const names = (payload.result.tools ?? []).map((tool) => tool.name).sort();

    expect(names).toEqual([
      "teak_v1_create_card",
      "teak_v1_delete_card",
      "teak_v1_list_favorite_cards",
      "teak_v1_search_cards",
      "teak_v1_set_card_favorite",
      "teak_v1_update_card",
    ]);
  });

  test("forwards each MCP tool to the canonical v1 gateway path", async () => {
    const authorization = "Bearer teakapi_forward";
    process.env.CONVEX_HTTP_BASE_URL = CONVEX_BASE_URL;

    const captured: Array<{
      url: string;
      method: string;
      authorization: string | null;
      bodyText: string;
    }> = [];

    globalThis.fetch = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const authorization = new Headers(init?.headers).get("authorization");
        const bodyText = init?.body
          ? await new Response(init.body as BodyInit).text()
          : "";

        captured.push({
          url,
          method,
          authorization,
          bodyText,
        });

        const parsedUrl = new URL(url);
        if (parsedUrl.pathname === "/v1/cards" && method === "POST") {
          return new Response(
            JSON.stringify({ status: "created", cardId: "card_1" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        if (parsedUrl.pathname === "/v1/cards/search" && method === "GET") {
          return new Response(JSON.stringify({ items: [], total: 2 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (parsedUrl.pathname === "/v1/cards/favorites" && method === "GET") {
          return new Response(JSON.stringify({ items: [], total: 1 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (
          parsedUrl.pathname === "/v1/cards/card_1/favorite" &&
          method === "PATCH"
        ) {
          return new Response(
            JSON.stringify({ id: "card_1", isFavorited: true }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        if (parsedUrl.pathname === "/v1/cards/card_1" && method === "PATCH") {
          return new Response(
            JSON.stringify({ id: "card_1", notes: null, tags: [] }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        if (parsedUrl.pathname === "/v1/cards/card_1" && method === "DELETE") {
          return new Response(null, { status: 204 });
        }

        return new Response(
          JSON.stringify({ code: "NOT_FOUND", error: "Not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    ) as unknown as typeof fetch;

    await initializeMcp({ authorization });

    const toolCalls = [
      {
        id: 10,
        name: "teak_v1_create_card",
        arguments: { content: "https://example.com" },
      },
      {
        id: 11,
        name: "teak_v1_search_cards",
        arguments: { q: "design", limit: 10 },
      },
      {
        id: 12,
        name: "teak_v1_list_favorite_cards",
        arguments: { q: "design", limit: 5 },
      },
      {
        id: 13,
        name: "teak_v1_update_card",
        arguments: { cardId: "card_1", notes: null, tags: [] },
      },
      {
        id: 14,
        name: "teak_v1_set_card_favorite",
        arguments: { cardId: "card_1", isFavorited: true },
      },
      {
        id: 15,
        name: "teak_v1_delete_card",
        arguments: { cardId: "card_1", confirm: true },
      },
    ] as const;

    for (const toolCall of toolCalls) {
      const response = await mcpRequest(
        {
          jsonrpc: "2.0",
          id: toolCall.id,
          method: "tools/call",
          params: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        },
        { authorization }
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as JsonRpcSuccess;
      expect(payload.result.isError).toBeUndefined();

      if (toolCall.name === "teak_v1_delete_card") {
        expect(payload.result.structuredContent).toEqual({
          status: "deleted",
          cardId: "card_1",
        });
      }
    }

    expect(captured).toHaveLength(7);

    expect(captured[0]).toMatchObject({
      url: MCP_AUTH_CHECK_URL,
      method: "GET",
      authorization,
    });

    expect(captured[1]).toMatchObject({
      url: `${CONVEX_BASE_URL}/v1/cards`,
      method: "POST",
      authorization,
    });
    expect(JSON.parse(captured[1].bodyText)).toEqual({
      content: "https://example.com",
    });

    expect(captured[2].url).toBe(
      `${CONVEX_BASE_URL}/v1/cards/search?q=design&limit=10`
    );
    expect(captured[2].method).toBe("GET");

    expect(captured[3].url).toBe(
      `${CONVEX_BASE_URL}/v1/cards/favorites?q=design&limit=5`
    );
    expect(captured[3].method).toBe("GET");

    expect(captured[4].url).toBe(`${CONVEX_BASE_URL}/v1/cards/card_1`);
    expect(captured[4].method).toBe("PATCH");
    expect(JSON.parse(captured[4].bodyText)).toEqual({
      notes: null,
      tags: [],
    });

    expect(captured[5].url).toBe(`${CONVEX_BASE_URL}/v1/cards/card_1/favorite`);
    expect(captured[5].method).toBe("PATCH");
    expect(JSON.parse(captured[5].bodyText)).toEqual({
      isFavorited: true,
    });

    expect(captured[6].url).toBe(`${CONVEX_BASE_URL}/v1/cards/card_1`);
    expect(captured[6].method).toBe("DELETE");
  });

  test("requires confirm=true for delete tool", async () => {
    const authorization = "Bearer teakapi_delete_confirm";
    process.env.CONVEX_HTTP_BASE_URL = CONVEX_BASE_URL;
    globalThis.fetch = mock(async () => {
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await initializeMcp({ authorization });

    const response = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "teak_v1_delete_card",
          arguments: { cardId: "card_1" },
        },
      },
      { authorization }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as JsonRpcSuccess;
    expect(payload.result.isError).toBe(true);
    const text = payload.result.content?.[0]?.text ?? "";
    expect(text.toLowerCase()).toContain("confirm");
  });

  test("maps upstream HTTP errors to MCP isError payload", async () => {
    const authorization = "Bearer teakapi_rate_limit";
    process.env.CONVEX_HTTP_BASE_URL = CONVEX_BASE_URL;

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      if (String(input) === MCP_AUTH_CHECK_URL) {
        return new Response(JSON.stringify({ items: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ code: "RATE_LIMITED", error: "Too many requests" }),
        {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as unknown as typeof fetch;

    await initializeMcp({ authorization });

    const response = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "teak_v1_create_card",
          arguments: { content: "hello" },
        },
      },
      { authorization }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as JsonRpcSuccess;
    expect(payload.result.isError).toBe(true);
    expect(payload.result.structuredContent).toEqual({
      status: 429,
      code: "RATE_LIMITED",
      error: "Too many requests",
    });
  });
});
