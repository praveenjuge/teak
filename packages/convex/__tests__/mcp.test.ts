import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  handleMcpV1Request,
  handleOauthProtectedResourceV1Request,
  rateLimitedJsonRpcRemainder,
} from "../mcp/httpServer";
import {
  answerProtocolMessage,
  buildInitializeResult,
  jsonRpcResponse,
  MCP_CORS_HEADERS,
} from "../mcp/protocol";
import {
  callTeakV1Tool,
  type PublicApiToolExecutor,
  TEAK_V1_TOOLS,
} from "../mcp/tools";
import { mockActionCtx } from "./helpers/convex.test-utils";
import { withMappedOwner } from "./helpers/session.test-utils";

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

const AUTHKIT_DOMAIN = "https://auth.teakvault.example";
const originalPublicOrigin = process.env.PUBLIC_ORIGIN;
const originalAuthkitDomain = process.env.WORKOS_AUTHKIT_DOMAIN;
const originalResourceOrigin = process.env.WORKOS_RESOURCE_ORIGIN;
const EXPECTED_TOOL_NAMES = [
  "fetch",
  "search",
  "teak_v1_add_cards_to_folder",
  "teak_v1_bulk_cards",
  "teak_v1_check_duplicate_url",
  "teak_v1_create_card",
  "teak_v1_create_folder",
  "teak_v1_create_thumbnail_upload",
  "teak_v1_create_upload",
  "teak_v1_delete_card",
  "teak_v1_delete_folder",
  "teak_v1_delete_tag",
  "teak_v1_find_similar_cards",
  "teak_v1_get_card",
  "teak_v1_get_card_changes",
  "teak_v1_get_card_content",
  "teak_v1_get_card_links",
  "teak_v1_get_folder",
  "teak_v1_get_me",
  "teak_v1_get_tag_operation",
  "teak_v1_list_cards",
  "teak_v1_list_favorite_cards",
  "teak_v1_list_folders",
  "teak_v1_list_tags",
  "teak_v1_merge_tags",
  "teak_v1_refresh_card",
  "teak_v1_remove_cards_from_folder",
  "teak_v1_rename_tag",
  "teak_v1_reset_card_thumbnail",
  "teak_v1_restore_card",
  "teak_v1_save_card_pdf",
  "teak_v1_search_cards",
  "teak_v1_set_card_archived",
  "teak_v1_set_card_done",
  "teak_v1_set_card_favorite",
  "teak_v1_set_card_thumbnail",
  "teak_v1_update_card",
  "teak_v1_update_folder",
];

beforeEach(() => {
  process.env.WORKOS_AUTHKIT_DOMAIN = AUTHKIT_DOMAIN;
});
afterEach(() => {
  if (originalPublicOrigin === undefined) {
    delete process.env.PUBLIC_ORIGIN;
  } else {
    process.env.PUBLIC_ORIGIN = originalPublicOrigin;
  }
  if (originalAuthkitDomain === undefined) {
    delete process.env.WORKOS_AUTHKIT_DOMAIN;
  } else {
    process.env.WORKOS_AUTHKIT_DOMAIN = originalAuthkitDomain;
  }
  if (originalResourceOrigin === undefined) {
    delete process.env.WORKOS_RESOURCE_ORIGIN;
  } else {
    process.env.WORKOS_RESOURCE_ORIGIN = originalResourceOrigin;
  }
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

const respondWith = (
  respond: (
    operation: Parameters<PublicApiToolExecutor>[0]
  ) => Response | Promise<Response>
) =>
  mock((operation: Parameters<PublicApiToolExecutor>[0]) =>
    Promise.resolve(respond(operation))
  );

describe("Convex MCP endpoint", () => {
  test("returns 401 with OAuth protected-resource challenge for missing auth", async () => {
    const response = await handleMcpV1Request(
      mockActionCtx({ runMutation: mock(), runQuery: mock() }),
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

  test.each([
    "https://api.teakvault.com",
    "https://uncommon-ladybug-882.convex.site",
  ])(
    "serves WorkOS protected-resource metadata with CORS on %s",
    async (origin: string) => {
      delete process.env.WORKOS_RESOURCE_ORIGIN;
      const response = await handleOauthProtectedResourceV1Request(
        new Request(`${origin}/.well-known/oauth-protected-resource`)
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(await response.json()).toEqual({
        resource: "https://teakvault.com/mcp",
        authorization_servers: [AUTHKIT_DOMAIN],
        bearer_methods_supported: ["header"],
        scopes_supported: ["openid", "profile", "email", "offline_access"],
        resource_name: "Teak",
      });
    }
  );

  test("serves the deployment's own resource, matching its MCP URL", async () => {
    const origin = "https://reminiscent-kangaroo-59.convex.site";
    process.env.WORKOS_RESOURCE_ORIGIN = origin;
    const response = await handleOauthProtectedResourceV1Request(
      new Request(`${origin}/.well-known/oauth-protected-resource/mcp`)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: `${origin}/mcp`,
      authorization_servers: [AUTHKIT_DOMAIN],
    });
  });

  test.each(["https://dev.convex.site/", "dev.convex.site", "http://10.0.0.5"])(
    "refuses a malformed WORKOS_RESOURCE_ORIGIN %s",
    (value: string) => {
      process.env.WORKOS_RESOURCE_ORIGIN = value;
      expect(() =>
        handleOauthProtectedResourceV1Request(
          new Request(
            "https://reminiscent-kangaroo-59.convex.site/.well-known/oauth-protected-resource"
          )
        )
      ).toThrow("WORKOS_RESOURCE_ORIGIN");
    }
  );

  test("derives the self-hosted MCP challenge from PUBLIC_ORIGIN", async () => {
    process.env.PUBLIC_ORIGIN = "https://api.selfhost.example";

    const challenge = await handleMcpV1Request(
      mockActionCtx({ runMutation: mock(), runQuery: mock() }),
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
      mockActionCtx({ runMutation: mock(), runQuery: mock() }),
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
      mockActionCtx({ runMutation: mock(), runQuery: mock() }),
      new Request("https://api.teakvault.com/mcp", { method: "GET" })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      "/.well-known/oauth-protected-resource"
    );
  });

  test("initializes and lists the Teak and ChatGPT-compatible tools", async () => {
    expect(TEAK_V1_TOOLS.map((tool): string => tool.name).sort()).toEqual(
      EXPECTED_TOOL_NAMES
    );

    const runMutation = mock().mockResolvedValue({
      keyId: "key_1",
      userId: "user_1",
      access: "full_access",
      source: "component",
      rateLimitKey: "component:key_1",
    });
    const ctx = mockActionCtx(
      withMappedOwner({
        runMutation,
        runQuery: mock(),
      })
    );
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

  test("answers protocol messages with the builders the Files Worker shares", async () => {
    const ctx = mockActionCtx(
      withMappedOwner({
        runMutation: mock().mockResolvedValue({
          keyId: "key_1",
          userId: "user_1",
          access: "full_access",
          source: "component",
          rateLimitKey: "component:key_1",
        }),
        runQuery: mock(),
      })
    );
    const params = { protocolVersion: "2026-07-28" };
    const initialize = await handleMcpV1Request(
      ctx,
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params })
    );
    expect(await initialize.json()).toEqual(
      jsonRpcResponse(1, buildInitializeResult(params))
    );
    for (const [name, value] of Object.entries(MCP_CORS_HEADERS)) {
      expect(initialize.headers.get(name)).toBe(value);
    }

    const list = await handleMcpV1Request(
      ctx,
      mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    );
    expect(await list.json()).toEqual(
      JSON.parse(JSON.stringify(jsonRpcResponse(2, { tools: TEAK_V1_TOOLS })))
    );

    const ping = await handleMcpV1Request(
      ctx,
      mcpRequest({ jsonrpc: "2.0", id: 3, method: "ping" })
    );
    expect(await ping.json()).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  });

  test("checks live credentials on consecutive MCP requests", async () => {
    const authorization = `Bearer teakapi_secret_live_b1c2d3e4_${"a".repeat(64)}`;
    const runMutation = mock().mockResolvedValue({
      keyId: "key_2",
      userId: "user_1",
      access: "full_access",
      source: "component",
      rateLimitKey: "component:key_2",
    });
    const ctx = mockActionCtx(
      withMappedOwner({
        runMutation,
        runQuery: mock(),
      })
    );

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
    expect(runMutation).toHaveBeenCalledTimes(2);
  });

  for (const [kind, authorization] of [
    ["API key", `Bearer teakapi_secret_live_c1d2e3f4_${"b".repeat(64)}`],
  ] as const) {
    test(`immediately rejects a revoked ${kind} after initialize`, async () => {
      const state: { revoked: boolean } = { revoked: false };
      const runMutation = mock(
        (_reference: unknown, args: { token?: string }) => {
          if (!args.token) {
            return Promise.resolve({ ok: true });
          }
          return Promise.resolve(
            state.revoked
              ? null
              : {
                  keyId: "connection",
                  userId: "owner",
                  access: "full_access",
                  source: "oauth",
                  rateLimitKey: "oauth:client:owner",
                }
          );
        }
      );
      const ctx = mockActionCtx(
        withMappedOwner({
          runMutation,
          runQuery: mock(),
        })
      );
      const initialize = await handleMcpV1Request(
        ctx,
        mcpRequest(
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-06-18" },
          },
          authorization
        )
      );
      expect(initialize.status).toBe(200);
      state.revoked = true;
      for (const method of ["tools/list", "ping", "tools/call"]) {
        const response = await handleMcpV1Request(
          ctx,
          mcpRequest(
            {
              jsonrpc: "2.0",
              id: 2,
              method,
              params: { name: "teak_v1_list_cards", arguments: {} },
            },
            authorization
          )
        );
        expect(response.status).toBe(401);
        expect(response.headers.get("WWW-Authenticate")).toContain(
          "resource_metadata="
        );
      }
    });
  }

  test("forwards MCP tools to the injected v1 executor", async () => {
    const captured: Array<{
      path: string;
      method: string;
      authorization: string | null;
      body?: unknown;
      query?: Record<string, unknown>;
    }> = [];
    const executor = respondWith(
      (operation: Parameters<PublicApiToolExecutor>[0]) => {
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
      }
    );
    const toolCalls = [
      ["teak_v1_list_cards", { limit: 25, cursor: "cursor_1", tag: "design" }],
      ["teak_v1_create_card", { content: "https://example.com" }],
      [
        "teak_v1_create_card",
        {
          fileEtag: '"upload-etag"',
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
      "GET /v1/cards",
      "DELETE /v1/cards/card_1",
      "GET /v1/cards/card_1",
      "GET /v1/tags",
      "GET /v1/cards/changes",
      "POST /v1/cards/bulk",
      "POST /v1/uploads",
      "GET /v1/cards",
      "GET /v1/cards/card_1",
    ]);
    expect(captured[2]?.body).toEqual({
      fileEtag: '"upload-etag"',
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
      include: "content,metadata",
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
    expect(captured[4]?.query).toEqual({
      q: "design",
      limit: 10,
      include: "content,metadata",
    });
    expect(captured[11]?.query).toEqual({
      q: "design",
      limit: 10,
      include: "content,metadata",
    });
  });

  test("finds similar cards through similarTo", async () => {
    const captured: Parameters<PublicApiToolExecutor>[0][] = [];
    const executor = mock((operation: Parameters<PublicApiToolExecutor>[0]) => {
      captured.push(operation);
      return Promise.resolve(
        Response.json({
          items: [{ id: "card_2" }],
          pageInfo: { hasMore: false, nextCursor: null },
          similarity: "ok",
        })
      );
    }) as PublicApiToolExecutor;
    const result = await callTeakV1Tool(
      "teak_v1_find_similar_cards",
      { cardId: "card_1", type: "image", limit: 5 },
      mcpRequest({ jsonrpc: "2.0", id: 53, method: "tools/call" }),
      executor
    );
    expect(captured[0]).toMatchObject({
      method: "GET",
      path: "/v1/cards",
      query: { similarTo: "card_1", type: "image", limit: 5 },
    });
    expect(result.structuredContent).toMatchObject({
      total: 1,
      similarity: "ok",
    });
  });

  test("get_card_links reads the card and returns only its links and backlinks", async () => {
    const captured: Parameters<PublicApiToolExecutor>[0][] = [];
    const links = [{ id: "card_2", missing: false, title: "B", type: "text" }];
    const executor = mock((operation: Parameters<PublicApiToolExecutor>[0]) => {
      captured.push(operation);
      return Promise.resolve(
        Response.json({
          backlinks: [],
          backlinksTruncated: false,
          content: "See [[B|teak:card_2]]",
          id: "card_1",
          links,
          linksTruncated: false,
        })
      );
    }) as PublicApiToolExecutor;
    const result = await callTeakV1Tool(
      "teak_v1_get_card_links",
      { cardId: "card_1" },
      mcpRequest({ jsonrpc: "2.0", id: 60, method: "tools/call" }),
      executor
    );
    expect(captured[0]).toMatchObject({
      method: "GET",
      path: "/v1/cards/card_1",
    });
    expect(result.structuredContent).toEqual({
      backlinks: [],
      backlinksTruncated: false,
      links,
      linksTruncated: false,
    });
    expect(result.content[0]).toMatchObject({
      text: "Card card_1 links to 1 card; 0 cards link to it",
    });
  });

  test("get_card_links says one card links to it and keeps the truncation flags", async () => {
    const executor = mock(() =>
      Promise.resolve(
        Response.json({
          backlinks: [
            { id: "card_2", missing: false, title: "B", type: "text" },
          ],
          backlinksTruncated: true,
          links: [],
          linksTruncated: true,
        })
      )
    ) as PublicApiToolExecutor;
    const result = await callTeakV1Tool(
      "teak_v1_get_card_links",
      { cardId: "card_1" },
      mcpRequest({ jsonrpc: "2.0", id: 61, method: "tools/call" }),
      executor
    );
    expect(result.content[0]).toMatchObject({
      text: "Card card_1 links to 0 cards; 1 card links to it",
    });
    expect(result.structuredContent).toMatchObject({
      backlinksTruncated: true,
      linksTruncated: true,
    });
  });

  test("search passes a reserved tag on and keeps isHidden on each card", async () => {
    const captured: Parameters<PublicApiToolExecutor>[0][] = [];
    const executor = mock((operation: Parameters<PublicApiToolExecutor>[0]) => {
      captured.push(operation);
      return Promise.resolve(
        Response.json({
          items: [{ id: "card_1", isHidden: true }],
          pageInfo: { hasMore: false, nextCursor: null },
        })
      );
    }) as PublicApiToolExecutor;
    const result = await callTeakV1Tool(
      "teak_v1_search_cards",
      { q: "#secret" },
      mcpRequest({ jsonrpc: "2.0", id: 54, method: "tools/call" }),
      executor
    );
    expect(captured[0]?.query).toMatchObject({ q: "#secret" });
    expect(result.structuredContent).toMatchObject({
      items: [{ id: "card_1", isHidden: true }],
      total: 1,
    });
  });

  test("passes text: through to search image text", async () => {
    const captured: Parameters<PublicApiToolExecutor>[0][] = [];
    const executor = mock((operation: Parameters<PublicApiToolExecutor>[0]) => {
      captured.push(operation);
      return Promise.resolve(
        Response.json({
          items: [{ id: "card_1" }],
          pageInfo: { hasMore: false, nextCursor: null },
        })
      );
    }) as PublicApiToolExecutor;
    const result = await callTeakV1Tool(
      "teak_v1_search_cards",
      { q: "text:4411" },
      mcpRequest({ jsonrpc: "2.0", id: 55, method: "tools/call" }),
      executor
    );
    expect(captured[0]?.query).toMatchObject({ q: "text:4411" });
    expect(result.structuredContent).toMatchObject({
      items: [{ id: "card_1" }],
    });
    const tool = TEAK_V1_TOOLS.find(
      (candidate) => candidate.name === "teak_v1_search_cards"
    );
    expect(tool?.description).toContain('text:"total due"');
  });

  test("passes the search mode through and reports the one that ran", async () => {
    const captured: Parameters<PublicApiToolExecutor>[0][] = [];
    const executor = mock((operation: Parameters<PublicApiToolExecutor>[0]) => {
      captured.push(operation);
      return Promise.resolve(
        Response.json({
          items: [{ id: "card_1" }],
          pageInfo: { hasMore: false, nextCursor: null },
          searchMode: "keyword",
        })
      );
    }) as PublicApiToolExecutor;
    const search = await callTeakV1Tool(
      "teak_v1_search_cards",
      { q: "cozy reading nook", mode: "semantic" },
      mcpRequest({ jsonrpc: "2.0", id: 51, method: "tools/call" }),
      executor
    );
    expect(captured[0]?.query).toMatchObject({
      q: "cozy reading nook",
      mode: "semantic",
    });
    expect(search.structuredContent).toMatchObject({ searchMode: "keyword" });
    await expect(
      callTeakV1Tool(
        "teak_v1_list_cards",
        { q: "chair", mode: "bogus" },
        mcpRequest({ jsonrpc: "2.0", id: 52, method: "tools/call" }),
        executor
      )
    ).resolves.toMatchObject({ isError: true });
    expect(captured).toHaveLength(1);
  });

  test("forwards search filters, new tools, and idempotency keys to the API", async () => {
    const captured: Parameters<PublicApiToolExecutor>[0][] = [];
    const executor = respondWith(
      (operation: Parameters<PublicApiToolExecutor>[0]) => {
        captured.push(operation);
        if (
          operation.method === "POST" &&
          operation.path.endsWith("/restore")
        ) {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (operation.path.endsWith("/save-pdf")) {
          const created = !captured
            .slice(0, -1)
            .some((earlier) => earlier.path.endsWith("/save-pdf"));
          return Promise.resolve(
            Response.json(
              { cardId: "doc_1", created },
              {
                status: created ? 201 : 200,
              }
            )
          );
        }
        return Promise.resolve(
          Response.json({
            cardId: null,
            items: [{ id: "card_1" }],
            pageInfo: { hasMore: true, nextCursor: "next" },
            data: {
              id: "u",
              email: "e",
              plan: "free",
              cardCount: 3,
              cardLimit: 200,
            },
          })
        );
      }
    );
    const call = (name: string, input: unknown) =>
      callTeakV1Tool(
        name,
        input,
        mcpRequest({ jsonrpc: "2.0", id: 50, method: "tools/call" }),
        executor
      );

    const search = await call("teak_v1_search_cards", {
      q: "poster",
      type: ["image", "link"],
      hue: ["blue"],
      trashed: true,
      include: ["content", "processing"],
    });
    expect(captured[0]?.query).toEqual({
      q: "poster",
      type: ["image", "link"],
      hue: ["blue"],
      trashed: true,
      include: "content,processing",
    });
    expect(search.structuredContent).toMatchObject({
      total: 1,
      pageInfo: { hasMore: true, nextCursor: "next" },
    });

    const restored = await call("teak_v1_restore_card", { cardId: "card_1" });
    expect(`${captured[1]?.method} ${captured[1]?.path}`).toBe(
      "POST /v1/cards/card_1/restore"
    );
    expect(restored.structuredContent).toEqual({
      status: "restored",
      cardId: "card_1",
    });

    await call("teak_v1_check_duplicate_url", { url: "https://example.com" });
    expect(captured[2]).toMatchObject({
      path: "/v1/cards/duplicate",
      query: { url: "https://example.com" },
    });

    const me = await call("teak_v1_get_me", {});
    expect(me.structuredContent).toMatchObject({ plan: "free", cardCount: 3 });

    await call("teak_v1_update_card", {
      cardId: "card_1",
      removeAiTags: ["x"],
    });
    expect(captured[4]?.body).toEqual({ removeAiTags: ["x"] });

    await call("teak_v1_create_card", {
      content: "a",
      idempotencyKey: "step-1",
    });
    expect(captured[5]?.body).toEqual({ content: "a" });
    expect(new Headers(captured[5]?.headers).get("Idempotency-Key")).toBe(
      "step-1"
    );

    await call("teak_v1_set_card_archived", {
      cardId: "card_1",
      isArchived: true,
    });
    expect(captured[6]).toMatchObject({
      method: "PATCH",
      path: "/v1/cards/card_1",
      body: { isArchived: true },
    });

    await call("teak_v1_list_cards", { archived: "only" });
    expect(captured[7]?.query).toMatchObject({ archived: "only" });

    await call("teak_v1_set_card_done", { cardId: "card_1", done: true });
    await call("teak_v1_set_card_done", { cardId: "card_1", done: false });
    expect(captured.slice(8, 10)).toMatchObject([
      { method: "POST", path: "/v1/cards/card_1/done" },
      { method: "DELETE", path: "/v1/cards/card_1/done" },
    ]);

    const saved = await call("teak_v1_save_card_pdf", { cardId: "card_1" });
    expect(captured[10]).toMatchObject({
      method: "POST",
      path: "/v1/cards/card_1/save-pdf",
    });
    expect(saved.content[0]?.text).toBe("Saved the PDF as card doc_1");
    expect(saved.structuredContent).toEqual({
      cardId: "doc_1",
      created: true,
    });
    const again = await call("teak_v1_save_card_pdf", { cardId: "card_1" });
    expect(again.content[0]?.text).toBe("The PDF is already card doc_1");
    expect(again.structuredContent).toEqual({
      cardId: "doc_1",
      created: false,
    });
  });

  test("tag tools start tag changes and poll their progress", async () => {
    const captured: Parameters<PublicApiToolExecutor>[0][] = [];
    const executor = respondWith(
      (operation: Parameters<PublicApiToolExecutor>[0]) => {
        captured.push(operation);
        return Promise.resolve(
          Response.json(
            {
              operationId: "op_1",
              id: "op_1",
              kind: "rename",
              status: operation.method === "GET" ? "completed" : "running",
              changed: 1,
              total: 1,
            },
            { status: operation.method === "GET" ? 200 : 202 }
          )
        );
      }
    );
    const call = (name: string, input: unknown) =>
      callTeakV1Tool(
        name,
        input,
        mcpRequest({ jsonrpc: "2.0", id: 52, method: "tools/call" }),
        executor
      );

    const renamed = await call("teak_v1_rename_tag", {
      from: "Design",
      to: "design-systems",
    });
    expect(captured[0]).toMatchObject({
      method: "POST",
      path: "/v1/tags/rename",
      body: { from: "Design", to: "design-systems" },
    });
    expect(renamed.structuredContent).toMatchObject({ operationId: "op_1" });

    await call("teak_v1_merge_tags", { from: "ux", into: "research" });
    expect(captured[1]).toMatchObject({
      method: "POST",
      path: "/v1/tags/merge",
      body: { from: "ux", into: "research" },
    });

    const unconfirmed = await call("teak_v1_delete_tag", { tag: "old" });
    expect(unconfirmed.isError).toBe(true);
    await call("teak_v1_delete_tag", { tag: "old", confirm: true });
    expect(captured[2]).toMatchObject({
      method: "POST",
      path: "/v1/tags/delete",
      body: { tag: "old" },
    });

    const polled = await call("teak_v1_get_tag_operation", {
      operationId: "op 1",
    });
    expect(captured[3]).toMatchObject({
      method: "GET",
      path: "/v1/tags/operations/op%201",
    });
    expect(polled.content[0]?.text).toBe(
      "Tag rename completed: 1 card changed of 1"
    );
    expect(captured).toHaveLength(4);
  });

  test("folder tools map onto the folder endpoints", async () => {
    const captured: Parameters<PublicApiToolExecutor>[0][] = [];
    const executor = respondWith(
      (operation: Parameters<PublicApiToolExecutor>[0]) => {
        captured.push(operation);
        if (
          operation.method === "DELETE" &&
          !operation.path.endsWith("/cards")
        ) {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          Response.json({
            id: "folder_1",
            name: "Reading",
            items: [{ id: "folder_1" }],
            updatedIds: ["card_1"],
            failedIds:
              operation.path.endsWith("/cards") && operation.method === "DELETE"
                ? ["card_2"]
                : [],
            folderLimitIds: [],
          })
        );
      }
    );
    const call = (name: string, input: unknown) =>
      callTeakV1Tool(
        name,
        input,
        mcpRequest({ jsonrpc: "2.0", id: 51, method: "tools/call" }),
        executor
      );

    const listed = await call("teak_v1_list_folders", {});
    expect(captured[0]).toMatchObject({ method: "GET", path: "/v1/folders" });
    expect(listed.content[0]?.text).toBe("Fetched 1 folder");

    const got = await call("teak_v1_get_folder", { folderId: "folder_1" });
    expect(captured.pop()).toMatchObject({
      method: "GET",
      path: "/v1/folders/folder_1",
    });
    expect(got.content[0]?.text).toBe("Fetched folder Reading");

    await call("teak_v1_create_folder", { name: "Reading", color: "blue" });
    expect(captured[1]).toMatchObject({
      method: "POST",
      path: "/v1/folders",
      body: { name: "Reading", color: "blue" },
    });

    await call("teak_v1_update_folder", { folderId: "folder_1", color: null });
    expect(captured[2]).toMatchObject({
      method: "PATCH",
      path: "/v1/folders/folder_1",
      body: { color: null },
    });
    const noChange = await call("teak_v1_update_folder", {
      folderId: "folder_1",
    });
    expect(noChange.isError).toBe(true);
    expect(captured).toHaveLength(3);

    const unconfirmed = await call("teak_v1_delete_folder", {
      folderId: "folder_1",
    });
    expect(unconfirmed.isError).toBe(true);
    const deleted = await call("teak_v1_delete_folder", {
      folderId: "folder_1",
      confirm: true,
    });
    expect(captured[3]).toMatchObject({
      method: "DELETE",
      path: "/v1/folders/folder_1",
    });
    expect(deleted.structuredContent).toEqual({
      status: "deleted",
      folderId: "folder_1",
    });

    const added = await call("teak_v1_add_cards_to_folder", {
      folderId: "folder_1",
      cardIds: ["card_1"],
    });
    expect(captured[4]).toMatchObject({
      method: "POST",
      path: "/v1/folders/folder_1/cards",
      body: { cardIds: ["card_1"] },
    });
    expect(added.isError).toBeFalsy();

    const removed = await call("teak_v1_remove_cards_from_folder", {
      folderId: "folder_1",
      cardIds: ["card_1", "card_2"],
    });
    expect(captured[5]).toMatchObject({
      method: "DELETE",
      path: "/v1/folders/folder_1/cards",
    });
    expect(removed.isError).toBe(true);
    expect(removed.content[0]?.text).toBe("Removed 1 card; 1 failed");

    await call("teak_v1_list_cards", { folder: "folder_1" });
    expect(captured[6]?.query).toMatchObject({ folder: "folder_1" });
  });

  test("labels every tool as read-only or as a write for MCP clients", () => {
    for (const tool of TEAK_V1_TOOLS) {
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
    }
    const byName = Object.fromEntries(
      TEAK_V1_TOOLS.map((tool) => [tool.name, tool.annotations])
    );
    expect(byName.teak_v1_search_cards?.readOnlyHint).toBe(true);
    expect(byName.teak_v1_delete_card?.destructiveHint).toBe(true);
  });

  test("favorite search tools use the canonical list transport", async () => {
    const captured: Array<{
      path: string;
      query?: Record<string, unknown>;
    }> = [];
    const executor = respondWith(
      (operation: Parameters<PublicApiToolExecutor>[0]) => {
        captured.push({ path: operation.path, query: operation.query });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [{ id: "card_1" }],
              pageInfo: { hasMore: false, nextCursor: null },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        );
      }
    );

    const result = await callTeakV1Tool(
      "teak_v1_list_favorite_cards",
      { limit: 5 },
      mcpRequest({ jsonrpc: "2.0", id: 40, method: "tools/call" }),
      executor
    );

    expect(result.isError).toBeUndefined();
    expect(captured[0]).toEqual({
      path: "/v1/cards",
      query: { limit: 5, include: "content,metadata", favorited: true },
    });
    expect(result.structuredContent).toMatchObject({
      items: [{ id: "card_1" }],
      total: 1,
    });
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
    expect(result.content[0]?.text.toLowerCase()).toContain("confirm");
  });

  test("forwards raw Markdown through create and update tools", async () => {
    const captured: Array<{ body?: unknown; method: string; path: string }> =
      [];
    const executor = respondWith(
      (operation: Parameters<PublicApiToolExecutor>[0]) => {
        captured.push(operation);
        return Response.json({
          appUrl: "https://app.teakvault.com/?card=card_1",
          cardId: "card_1",
          content: (operation.body as { content?: string } | undefined)
            ?.content,
          id: "card_1",
          status: "created",
          type: "text",
        });
      }
    );
    const created = "\uFEFF  # MCP\r\n\r\n- [ ] create  \n";
    const updated = "  ---\r\ntitle: Update\r\n---  ";

    await callTeakV1Tool(
      "teak_v1_create_card",
      { cardType: "text", content: created },
      mcpRequest({ jsonrpc: "2.0", id: 40, method: "tools/call" }),
      executor
    );
    await callTeakV1Tool(
      "teak_v1_update_card",
      { cardId: "card_1", content: updated },
      mcpRequest({ jsonrpc: "2.0", id: 41, method: "tools/call" }),
      executor
    );

    expect(captured[0]).toMatchObject({
      body: { cardType: "text", content: created },
      method: "POST",
      path: "/v1/cards",
    });
    expect(captured[1]).toMatchObject({
      body: { content: updated },
      method: "PATCH",
      path: "/v1/cards/card_1",
    });
  });

  test("create_card sends the page a text card came from", async () => {
    const captured: Array<{ body?: unknown }> = [];
    const executor = respondWith(
      (operation: Parameters<PublicApiToolExecutor>[0]) => {
        captured.push(operation);
        return Response.json({ cardId: "card_1", status: "created" });
      }
    );
    const tool = TEAK_V1_TOOLS.find(
      (entry) => entry.name === "teak_v1_create_card"
    );
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["sourceTitle", "sourceUrl"])
    );

    const result = await callTeakV1Tool(
      "teak_v1_create_card",
      {
        cardType: "text",
        content: "A quote",
        sourceTitle: "An essay",
        sourceUrl: "https://example.com/essay",
      },
      mcpRequest({ jsonrpc: "2.0", id: 42, method: "tools/call" }),
      executor
    );

    expect(result.isError).toBeUndefined();
    expect(captured[0]?.body).toEqual({
      cardType: "text",
      content: "A quote",
      sourceTitle: "An essay",
      sourceUrl: "https://example.com/essay",
    });
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
    expect(result.content[0]?.text).toContain("mimeType");
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
    expect(result.content[0]?.text.toLowerCase()).toContain("expected true");
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

  test("accepts a 100-message JSON-RPC batch", async () => {
    const runMutation = mock().mockResolvedValue({
      keyId: "key_1",
      userId: "user_1",
      access: "full_access",
      source: "component",
      rateLimitKey: "component:key_1",
    });
    const ctx = mockActionCtx(
      withMappedOwner({
        runMutation,
        runQuery: mock(),
      })
    );
    const batch = Array.from({ length: 100 }, (_, index) => ({
      jsonrpc: "2.0",
      id: index + 1,
      method: "initialize",
    }));
    const response = await handleMcpV1Request(
      ctx,
      new Request("https://api.teakvault.com/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: TEST_AUTHORIZATION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      })
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Array<{ id: number }>;
    expect(payload).toHaveLength(100);
    expect(payload[0]?.id).toBe(1);
    expect(payload[99]?.id).toBe(100);
  });

  test("rejects JSON-RPC batches over 100 messages before tool execution", async () => {
    const runMutation = mock().mockResolvedValue({
      keyId: "key_1",
      userId: "user_1",
      access: "full_access",
      source: "component",
      rateLimitKey: "component:key_1",
    });
    const ctx = mockActionCtx(
      withMappedOwner({
        runMutation,
        runQuery: mock(),
      })
    );
    const batch = Array.from({ length: 101 }, (_, index) => ({
      jsonrpc: "2.0",
      id: index + 1,
      method: "tools/call",
      params: { name: "teak_v1_list_cards", arguments: {} },
    }));
    const response = await handleMcpV1Request(
      ctx,
      new Request("https://api.teakvault.com/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: TEST_AUTHORIZATION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      })
    );

    const payload = (await response.json()) as {
      error?: { message?: string };
    };
    expect(response.status).toBe(400);
    expect(payload.error?.message).toContain("100");
  });

  test("synthesizes remaining batch errors with original request IDs", () => {
    const remainder = rateLimitedJsonRpcRemainder([
      { jsonrpc: "2.0", id: 12, method: "tools/call" },
      { jsonrpc: "2.0", method: "notifications/cancelled" },
      { jsonrpc: "2.0", id: "follow-up", method: "tools/call" },
    ]);

    expect(remainder).toEqual([
      {
        jsonrpc: "2.0",
        id: 12,
        error: { code: -32_000, message: "Rate limited" },
      },
      {
        jsonrpc: "2.0",
        id: "follow-up",
        error: { code: -32_000, message: "Rate limited" },
      },
    ]);
  });

  test("omits responses for rate-limited notifications without an id", () => {
    const remainder = rateLimitedJsonRpcRemainder([
      { jsonrpc: "2.0", method: "tools/call" },
      { jsonrpc: "2.0", id: 8, method: "tools/call" },
    ]);

    expect(remainder).toEqual([
      {
        jsonrpc: "2.0",
        id: 8,
        error: { code: -32_000, message: "Rate limited" },
      },
    ]);
  });

  const authorizedCtx = () =>
    mockActionCtx(
      withMappedOwner({
        runMutation: mock().mockResolvedValue({
          keyId: "key_1",
          userId: "user_1",
          access: "full_access",
          source: "component",
          rateLimitKey: "component:key_1",
        }),
        runQuery: mock(),
      })
    );

  test("answers an unknown tool with JSON-RPC invalid params", async () => {
    const response = await handleMcpV1Request(
      authorizedCtx(),
      mcpRequest({
        jsonrpc: "2.0",
        id: 50,
        method: "tools/call",
        params: { name: "teak_v1_explode", arguments: {} },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 50,
      error: { code: -32_602, message: "Unknown tool: teak_v1_explode" },
    });
  });

  test("answers malformed JSON with HTTP 400 and a parse error", async () => {
    const response = await handleMcpV1Request(
      authorizedCtx(),
      new Request("https://api.teakvault.com/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: TEST_AUTHORIZATION,
          "Content-Type": "application/json",
        },
        body: '{"jsonrpc":"2.0","id":1,',
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32_700, message: "Parse error" },
    });
  });

  test("answers valid JSON that isn't a request object with invalid request", async () => {
    const response = await handleMcpV1Request(
      authorizedCtx(),
      new Request("https://api.teakvault.com/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: TEST_AUTHORIZATION,
          "Content-Type": "application/json",
        },
        body: "42",
      })
    );

    expect(await response.json()).toMatchObject({
      error: { code: -32_600 },
    });
  });

  test.each([
    ["teak_v1_search_cards", -5],
    ["teak_v1_search_cards", 0],
    ["teak_v1_search_cards", 101],
    ["teak_v1_list_favorite_cards", -5],
    ["teak_v1_list_cards", 101],
  ])(
    "%s rejects limit %p before calling the API",
    async (tool: string, limit: number) => {
      const executor = mock(async () =>
        Response.json({ items: [], pageInfo: { hasMore: false } })
      ) as PublicApiToolExecutor;
      const result = await callTeakV1Tool(
        tool,
        { q: "design", limit },
        mcpRequest({ jsonrpc: "2.0", id: 51, method: "tools/call" }),
        executor
      );

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ code: "INVALID_INPUT" });
      expect(executor).not.toHaveBeenCalled();
    }
  );

  test("flags a bulk operation with failed items as a tool error", async () => {
    const executor = mock(async () =>
      Response.json({
        operation: "create",
        results: [
          { index: 0, status: "success", cardId: "card_1" },
          {
            index: 1,
            status: "error",
            code: "INVALID_INPUT",
            error: "Each create item must include `content` or `url`",
          },
        ],
        summary: { total: 2, succeeded: 1, failed: 1 },
      })
    ) as PublicApiToolExecutor;
    const result = await callTeakV1Tool(
      "teak_v1_bulk_cards",
      { operation: "create", items: [{ content: "a" }, {}] },
      mcpRequest({ jsonrpc: "2.0", id: 52, method: "tools/call" }),
      executor
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      summary: { total: 2, succeeded: 1, failed: 1 },
    });
    expect(result.content[0]?.text).toContain("1 of 2 items failed");
    expect(result.content[0]?.text).toContain("INVALID_INPUT");
  });

  test("reports a fully successful bulk operation without an error", async () => {
    const executor = mock(async () =>
      Response.json({
        operation: "favorite",
        results: [{ index: 0, status: "success", cardId: "card_1" }],
        summary: { total: 1, succeeded: 1, failed: 0 },
      })
    ) as PublicApiToolExecutor;
    const result = await callTeakV1Tool(
      "teak_v1_bulk_cards",
      {
        operation: "favorite",
        items: [{ cardId: "card_1", isFavorited: true }],
      },
      mcpRequest({ jsonrpc: "2.0", id: 53, method: "tools/call" }),
      executor
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(
      "Bulk favorite complete: 1 of 1 succeeded"
    );
  });
});

describe("link image tools", () => {
  const run = async (tool: string, input: unknown) => {
    const captured: Parameters<PublicApiToolExecutor>[0][] = [];
    const result = await callTeakV1Tool(
      tool,
      input,
      mcpRequest({ jsonrpc: "2.0", id: 70, method: "tools/call" }),
      mock((operation: Parameters<PublicApiToolExecutor>[0]) => {
        const { headers: _headers, ...request } = operation;
        captured.push(request);
        return Promise.resolve(Response.json({ id: "card_1" }));
      }) as PublicApiToolExecutor
    );
    return { captured, result };
  };

  test("upload, apply and reset reach the thumbnail routes", async () => {
    const upload = await run("teak_v1_create_thumbnail_upload", {
      cardId: "card_1",
      fileSize: 2048,
      mimeType: "image/webp",
    });
    expect(upload.captured).toEqual([
      {
        body: { fileSize: 2048, mimeType: "image/webp" },
        method: "POST",
        path: "/v1/cards/card_1/thumbnail/upload",
      },
    ]);
    const set = await run("teak_v1_set_card_thumbnail", {
      cardId: "card_1",
      fileKey: "pending/key",
    });
    expect(set.captured).toEqual([
      {
        body: { fileKey: "pending/key" },
        method: "PUT",
        path: "/v1/cards/card_1/thumbnail",
      },
    ]);
    const reset = await run("teak_v1_reset_card_thumbnail", {
      cardId: "card_1",
    });
    expect(reset.captured).toEqual([
      { method: "DELETE", path: "/v1/cards/card_1/thumbnail" },
    ]);
  });

  test.each([
    { mimeType: "image/svg+xml", fileSize: 10 },
    { mimeType: "image/heic", fileSize: 10 },
    { mimeType: "image/png", fileSize: 20 * 1024 * 1024 + 1 },
  ])(
    "refuses %o before calling the API",
    async (input: { fileSize: number; mimeType: string }) => {
      const { captured, result } = await run(
        "teak_v1_create_thumbnail_upload",
        {
          cardId: "card_1",
          ...input,
        }
      );
      expect(result.isError).toBe(true);
      expect(captured).toEqual([]);
    }
  );
});

describe("answerProtocolMessage", () => {
  test("replies to a ping without Convex", () => {
    expect(
      answerProtocolMessage({ id: 7, jsonrpc: "2.0", method: "ping" })
    ).toEqual({ kind: "reply", reply: jsonRpcResponse(7, {}) });
  });

  test("sends no reply to a notification", () => {
    expect(
      answerProtocolMessage({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      })
    ).toEqual({ kind: "noReply" });
  });

  test.each([
    ["a tool call", { id: 1, jsonrpc: "2.0", method: "tools/call" }],
    ["an unknown method", { id: 1, jsonrpc: "2.0", method: "resources/list" }],
    ["a message without jsonrpc 2.0", { id: 1, method: "ping" }],
    ["a batch array", [{ id: 1, jsonrpc: "2.0", method: "ping" }]],
  ])("leaves %s to Convex", (_label, message) => {
    expect(answerProtocolMessage(message)).toEqual({ kind: "needsConvex" });
  });
});
