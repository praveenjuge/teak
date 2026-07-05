import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  handleMcpV1Request,
  handleOauthProtectedResourceV1Request,
} from "../mcp/httpServer";
import {
  callTeakV1Tool,
  type PublicApiToolExecutor,
  TEAK_V1_TOOLS,
} from "../mcp/tools";

interface JsonRpcSuccess {
  id: number;
  jsonrpc: "2.0";
  result: {
    tools?: Array<{ name: string }>;
    structuredContent?: Record<string, unknown>;
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
}

const TEST_AUTHORIZATION = `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;

const originalPublicApiUrl = process.env.PUBLIC_API_URL;
const originalAuthIssuerUrl = process.env.AUTH_ISSUER_URL;
const originalSiteUrl = process.env.SITE_URL;

afterEach(() => {
  process.env.PUBLIC_API_URL = originalPublicApiUrl;
  process.env.AUTH_ISSUER_URL = originalAuthIssuerUrl;
  process.env.SITE_URL = originalSiteUrl;
});

const mcpRequest = (
  body: Record<string, unknown>,
  authorization = TEST_AUTHORIZATION
): Request =>
  new Request("https://api.teakvault.com/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: authorization,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });

const initializeMcp = (ctx: any) =>
  handleMcpV1Request(
    ctx,
    mcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "teak-convex-tests",
          version: "1.0.0",
        },
      },
    })
  );

describe("Convex MCP endpoint", () => {
  test("returns 401 with OAuth protected-resource challenge for missing auth", async () => {
    const response = await handleMcpV1Request(
      { runMutation: mock(), runQuery: mock() },
      new Request("https://api.teakvault.com/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      error: "Missing or invalid Authorization header",
    });
    expect(response.headers.get("WWW-Authenticate")).toContain(
      "/.well-known/oauth-protected-resource"
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("serves OAuth protected-resource metadata with CORS", async () => {
    process.env.SITE_URL = "https://app.teakvault.com";

    const response = await handleOauthProtectedResourceV1Request(
      new Request(
        "https://api.teakvault.com/.well-known/oauth-protected-resource"
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.json()).toEqual({
      resource: "https://api.teakvault.com/mcp",
      authorization_servers: ["https://app.teakvault.com"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["profile", "email", "offline_access"],
      resource_name: "Teak",
    });
  });

  test("uses the incoming Convex site origin for dev protected-resource metadata", async () => {
    const response = await handleOauthProtectedResourceV1Request(
      new Request(
        "https://reminiscent-kangaroo-59.convex.site/.well-known/oauth-protected-resource"
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: "https://reminiscent-kangaroo-59.convex.site/mcp",
    });
  });

  test("uses the public API origin for production Convex metadata", async () => {
    const response = await handleOauthProtectedResourceV1Request(
      new Request(
        "https://uncommon-ladybug-882.convex.site/.well-known/oauth-protected-resource"
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: "https://api.teakvault.com/mcp",
    });
  });

  test("lets unauthenticated OPTIONS /mcp preflight through", async () => {
    const response = await handleMcpV1Request(
      { runMutation: mock(), runQuery: mock() },
      new Request("https://api.teakvault.com/mcp", { method: "OPTIONS" })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST"
    );
  });

  test("challenges unauthenticated non-POST MCP requests", async () => {
    const response = await handleMcpV1Request(
      { runMutation: mock(), runQuery: mock() },
      new Request("https://api.teakvault.com/mcp", { method: "GET" })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      "/.well-known/oauth-protected-resource"
    );
  });

  test("initializes and lists the six teak_v1 tools", async () => {
    expect(TEAK_V1_TOOLS.map((tool) => tool.name).sort()).toEqual([
      "teak_v1_create_card",
      "teak_v1_delete_card",
      "teak_v1_list_favorite_cards",
      "teak_v1_search_cards",
      "teak_v1_set_card_favorite",
      "teak_v1_update_card",
    ]);

    const runMutation = mock().mockResolvedValue({
      keyId: "key_1",
      userId: "user_1",
      access: "full_access",
      source: "component",
      rateLimitKey: "component:key_1",
    });
    const ctx = { runMutation, runQuery: mock() };
    expect((await initializeMcp(ctx)).status).toBe(200);

    const listResponse = await handleMcpV1Request(
      ctx,
      mcpRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      })
    );
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

  test("caches successful MCP bearer validation briefly", async () => {
    const authorization = `Bearer teakapi_secret_live_b1c2d3e4_${"a".repeat(64)}`;
    const runMutation = mock().mockResolvedValue({
      keyId: "key_2",
      userId: "user_1",
      access: "full_access",
      source: "component",
      rateLimitKey: "component:key_2",
    });
    const ctx = { runMutation, runQuery: mock() };

    const firstResponse = await handleMcpV1Request(
      ctx,
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 20,
          method: "initialize",
          params: { protocolVersion: "2025-06-18" },
        },
        authorization
      )
    );
    const secondResponse = await handleMcpV1Request(
      ctx,
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 21,
          method: "tools/list",
          params: {},
        },
        authorization
      )
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  test("forwards MCP tools to the injected v1 executor", async () => {
    const captured: Array<{
      path: string;
      method: string;
      authorization: string | null;
      body?: unknown;
      query?: Record<string, unknown>;
    }> = [];
    const executor = mock((operation: Parameters<PublicApiToolExecutor>[0]) => {
      captured.push({
        path: operation.path,
        method: operation.method,
        authorization: new Headers(operation.headers).get("authorization"),
        body: operation.body,
        query: operation.query,
      });

      if (operation.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ status: "created", cardId: "card_1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }) as PublicApiToolExecutor;
    for (const toolCall of [
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
        name: "teak_v1_delete_card",
        arguments: { cardId: "card_1", confirm: true },
      },
    ] as const) {
      const result = await callTeakV1Tool(
        toolCall.name,
        toolCall.arguments,
        mcpRequest({ jsonrpc: "2.0", id: toolCall.id, method: "tools/call" }),
        executor
      );
      expect(result.isError).toBeUndefined();
    }

    expect(captured).toEqual([
      {
        path: "/v1/cards",
        method: "POST",
        authorization: TEST_AUTHORIZATION,
        body: { content: "https://example.com" },
        query: undefined,
      },
      {
        path: "/v1/cards/search",
        method: "GET",
        authorization: TEST_AUTHORIZATION,
        body: undefined,
        query: { q: "design", limit: 10 },
      },
      {
        path: "/v1/cards/card_1",
        method: "DELETE",
        authorization: TEST_AUTHORIZATION,
        body: undefined,
        query: undefined,
      },
    ]);
  });

  test("requires confirm=true for delete tool", async () => {
    const result = await callTeakV1Tool(
      "teak_v1_delete_card",
      { cardId: "card_1" },
      mcpRequest({ jsonrpc: "2.0", id: 3, method: "tools/call" }),
      mock(
        async () => new Response(null, { status: 204 })
      ) as PublicApiToolExecutor
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text.toLowerCase()).toContain("confirm");
  });

  test("maps v1 errors to MCP isError payloads", async () => {
    const result = await callTeakV1Tool(
      "teak_v1_create_card",
      { content: "hello" },
      mcpRequest({ jsonrpc: "2.0", id: 4, method: "tools/call" }),
      mock(
        async () =>
          new Response(
            JSON.stringify({
              code: "RATE_LIMITED",
              error: "Too many requests",
            }),
            {
              status: 429,
              headers: { "Content-Type": "application/json" },
            }
          )
      ) as PublicApiToolExecutor
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      status: 429,
      code: "RATE_LIMITED",
      error: "Too many requests",
    });
  });
});
