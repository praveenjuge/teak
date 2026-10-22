import { describe, expect, mock, test } from "bun:test";
import {
  handleMcpV1Request,
  handleOauthProtectedResourceV1Request,
  rateLimitedJsonRpcRemainder,
} from "../../mcp/httpServer";
import { TEAK_V1_TOOLS } from "../../mcp/tools";
import { mockActionCtx } from "../helpers/convex.test-utils";
import {
  AUTHKIT_DOMAIN,
  EXPECTED_TOOL_NAMES,
  initializeMcp,
  type JsonRpcSuccess,
  mcpRequest,
  setUpMcpEnv,
  TEST_AUTHORIZATION,
} from "../helpers/mcp.test-utils";
import { withMappedOwner } from "../helpers/session.test-utils";

setUpMcpEnv();

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
});
