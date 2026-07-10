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
const originalPublicMcpUrl = process.env.PUBLIC_MCP_URL;
const originalAuthIssuerUrl = process.env.AUTH_ISSUER_URL;
const originalSiteUrl = process.env.SITE_URL;
const EXPECTED_TOOL_NAMES = [
  "fetch",
  "search",
  "teak_v1_bulk_cards",
  "teak_v1_create_card",
  "teak_v1_create_upload",
  "teak_v1_delete_card",
  "teak_v1_get_card",
  "teak_v1_get_card_changes",
  "teak_v1_list_cards",
  "teak_v1_list_favorite_cards",
  "teak_v1_list_tags",
  "teak_v1_search_cards",
  "teak_v1_set_card_favorite",
  "teak_v1_update_card",
];

afterEach(() => {
  process.env.PUBLIC_API_URL = originalPublicApiUrl;
  process.env.PUBLIC_MCP_URL = originalPublicMcpUrl;
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
      'resource_metadata="https://teakvault.com/.well-known/oauth-protected-resource/mcp"'
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
      resource: "https://teakvault.com/mcp",
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
      resource: "https://teakvault.com/mcp",
    });
  });

  test("derives self-hosted MCP metadata from PUBLIC_API_URL", async () => {
    process.env.PUBLIC_API_URL = "https://api.selfhost.example";
    process.env.PUBLIC_MCP_URL = "";

    const response = await handleOauthProtectedResourceV1Request(
      new Request(
        "https://api.selfhost.example/.well-known/oauth-protected-resource"
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: "https://api.selfhost.example/mcp",
    });

    const challenge = await handleMcpV1Request(
      { runMutation: mock(), runQuery: mock() },
      new Request("https://api.selfhost.example/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      })
    );
    expect(challenge.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://api.selfhost.example/.well-known/oauth-protected-resource/mcp"'
    );
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

  test("initializes and lists the Teak and ChatGPT-compatible tools", async () => {
    expect(TEAK_V1_TOOLS.map((tool) => tool.name).sort()).toEqual(
      EXPECTED_TOOL_NAMES
    );

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
    expect(names).toEqual(EXPECTED_TOOL_NAMES);
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
        new Response(
          JSON.stringify({
            id: "card_1",
            appUrl: "https://app.teakvault.com/?card=card_1",
            cardId: "card_1",
            content: "Design note",
            deletedIds: ["card_2"],
            fileKey: "users/user_1/file/image.png",
            items: [{ id: "card_1", metadataTitle: "Design note" }],
            metadataTitle: "Design note",
            pageInfo: { hasMore: false, nextCursor: null },
            status: "created",
            total: 1,
            uploadUrl: "https://upload.example",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    }) as PublicApiToolExecutor;
    const toolCalls = [
      ["teak_v1_list_cards", { limit: 25, cursor: "cursor_1", tag: "design" }],
      ["teak_v1_create_card", { content: "https://example.com" }],
      [
        "teak_v1_create_card",
        {
          fileKey: "users/user_1/file/readme.md",
          fileName: "readme.md",
          fileSize: 42,
          mimeType: "text/markdown",
        },
      ],
      [
        "teak_v1_create_card",
        {
          cardType: "image",
          fileKey: "users/user_1/file/image.png",
          fileName: "image.png",
          fileSize: 123,
          mimeType: "image/png",
        },
      ],
      ["teak_v1_search_cards", { q: "design", limit: 10 }],
      ["teak_v1_delete_card", { cardId: "card_1", confirm: true }],
      ["teak_v1_get_card", { cardId: "card_1" }],
      ["teak_v1_list_tags", {}],
      ["teak_v1_get_card_changes", { since: 1_710_000_000_000, limit: 10 }],
      [
        "teak_v1_bulk_cards",
        {
          operation: "favorite",
          items: [{ cardId: "card_1", isFavorited: true }],
        },
      ],
      [
        "teak_v1_create_upload",
        { fileName: "image.png", mimeType: "image/png", fileSize: 123 },
      ],
      ["search", { query: "design" }],
      ["fetch", { id: "card_1" }],
    ] as const;
    for (const [index, toolCall] of toolCalls.entries()) {
      const result = await callTeakV1Tool(
        toolCall[0],
        toolCall[1],
        mcpRequest({ jsonrpc: "2.0", id: index + 9, method: "tools/call" }),
        executor
      );
      expect(result.isError).toBeUndefined();
    }

    expect(captured.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /v1/cards",
      "POST /v1/cards",
      "POST /v1/cards",
      "POST /v1/cards",
      "GET /v1/cards/search",
      "DELETE /v1/cards/card_1",
      "GET /v1/cards/card_1",
      "GET /v1/tags",
      "GET /v1/cards/changes",
      "POST /v1/cards/bulk",
      "POST /v1/uploads",
      "GET /v1/cards/search",
      "GET /v1/cards/card_1",
    ]);
    expect(captured[2]?.body).toEqual({
      fileKey: "users/user_1/file/readme.md",
      fileName: "readme.md",
      fileSize: 42,
      mimeType: "text/markdown",
    });
    expect(captured[3]?.body).toMatchObject({ cardType: "image" });
    expect(
      captured.every((call) => call.authorization === TEST_AUTHORIZATION)
    ).toBe(true);
    expect(captured[0]?.query).toEqual({
      cursor: "cursor_1",
      tag: "design",
      limit: 25,
    });
    expect(captured[1]?.body).toEqual({ content: "https://example.com" });
    expect(captured[9]?.body).toEqual({
      operation: "favorite",
      items: [{ cardId: "card_1", isFavorited: true }],
    });
    expect(captured[10]?.body).toEqual({
      fileName: "image.png",
      mimeType: "image/png",
      fileSize: 123,
    });
    expect(captured[11]?.query).toEqual({ q: "design", limit: 10 });
  });

  test("requires confirm=true for bulk delete tool", async () => {
    const result = await callTeakV1Tool(
      "teak_v1_bulk_cards",
      { operation: "delete", items: [{ cardId: "card_1" }] },
      mcpRequest({ jsonrpc: "2.0", id: 30, method: "tools/call" }),
      mock(
        async () => new Response(JSON.stringify({}), { status: 200 })
      ) as PublicApiToolExecutor
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text.toLowerCase()).toContain("confirm");
  });

  test("returns a validation error for incomplete file-card input", async () => {
    const executor = mock(async () =>
      Response.json({ status: "created", cardId: "unexpected" })
    ) as PublicApiToolExecutor;
    const result = await callTeakV1Tool(
      "teak_v1_create_card",
      {
        fileKey: "users/user_1/file/readme.md",
        fileName: "readme.md",
      },
      mcpRequest({ jsonrpc: "2.0", id: 29, method: "tools/call" }),
      executor
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("mimeType");
    expect(executor).not.toHaveBeenCalled();
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
    expect(result.content?.[0]?.text.toLowerCase()).toContain("expected true");
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
