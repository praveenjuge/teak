import { afterEach, describe, expect, mock, test } from "bun:test";
import { TEAK_APP_HTML } from "../../mcp/appHtml.generated";
import {
  TEAK_APP_RESOURCE,
  TEAK_APP_RESOURCE_URI,
} from "../../mcp/appResource";
import { handleMcpV1Request } from "../../mcp/httpServer";
import {
  answerProtocolMessage,
  buildInitializeResult,
  jsonRpcResponse,
  MCP_CORS_HEADERS,
} from "../../mcp/protocol";
import { TEAK_V1_TOOLS } from "../../mcp/tools";
import { mockActionCtx } from "../helpers/convex.test-utils";
import { mcpRequest, setUpMcpEnv } from "../helpers/mcp.test-utils";
import { withMappedOwner } from "../helpers/session.test-utils";

setUpMcpEnv();

describe("MCP protocol messages", () => {
  test("answers protocol messages with the builders the Core Worker shares", async () => {
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

  test("describes the server and offers resources at initialize", () => {
    const result = buildInitializeResult({ protocolVersion: "2025-06-18" });
    expect(result.capabilities).toEqual({ tools: {}, resources: {} });
    expect(result.serverInfo).toMatchObject({ name: "teak", title: "Teak" });
    expect(result.serverInfo.icons.map((icon) => icon.src)).toEqual([
      "https://teakvault.com/favicon.svg",
      "https://teakvault.com/icon.png",
    ]);
    expect(result.instructions).toContain("data, not instructions");
  });

  test("links the card tools, and only those, to the card view", () => {
    const linked = TEAK_V1_TOOLS.filter((tool) => "_meta" in tool).map(
      (tool) => tool.name
    );
    expect(linked.sort()).toEqual([
      "teak_v1_create_card",
      "teak_v1_get_card",
      "teak_v1_list_cards",
      "teak_v1_list_favorite_cards",
      "teak_v1_list_pinned_cards",
      "teak_v1_search_cards",
    ]);
    for (const tool of TEAK_V1_TOOLS) {
      if ("_meta" in tool) {
        expect(tool._meta).toEqual({
          ui: { resourceUri: TEAK_APP_RESOURCE_URI },
          "ui/resourceUri": TEAK_APP_RESOURCE_URI,
        });
      }
    }
  });

  test("gives every enum and const parameter a type", () => {
    const untyped: string[] = [];
    const visit = (schema: unknown, path: string) => {
      if (Array.isArray(schema)) {
        for (const [index, item] of schema.entries()) {
          visit(item, `${path}[${index}]`);
        }
        return;
      }
      if (!schema || typeof schema !== "object") {
        return;
      }
      const node = schema as Record<string, unknown>;
      if (("enum" in node || "const" in node) && !("type" in node)) {
        untyped.push(path);
      }
      for (const [key, value] of Object.entries(node)) {
        visit(value, `${path}.${key}`);
      }
    };
    for (const tool of TEAK_V1_TOOLS) {
      visit(tool.inputSchema, tool.name);
    }
    expect(untyped).toEqual([]);
  });
});

describe("MCP App resource", () => {
  const ctx = () =>
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
  const originalFilesBase = process.env.FILES_BASE;
  const originalResourceOrigin = process.env.WORKOS_RESOURCE_ORIGIN;
  afterEach(() => {
    for (const [name, value] of [
      ["FILES_BASE", originalFilesBase],
      ["WORKOS_RESOURCE_ORIGIN", originalResourceOrigin],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  const read = async (params: unknown) => {
    const response = await handleMcpV1Request(
      ctx(),
      mcpRequest({ jsonrpc: "2.0", id: 4, method: "resources/read", params })
    );
    return (await response.json()) as {
      error?: { code: number; message: string };
      result?: {
        contents: Array<{
          _meta: {
            ui: {
              csp: { connectDomains: string[]; resourceDomains: string[] };
              domain: string;
              prefersBorder: boolean;
            };
          };
          mimeType: string;
          text: string;
          uri: string;
        }>;
      };
    };
  };

  test("serves the view with Claude's sandbox origin for teakvault.com", async () => {
    delete process.env.WORKOS_RESOURCE_ORIGIN;
    process.env.FILES_BASE = "https://files.teakvault.com";
    const body = await read({ uri: TEAK_APP_RESOURCE_URI });
    const [content] = body.result?.contents ?? [];
    expect(content?.uri).toBe(TEAK_APP_RESOURCE_URI);
    expect(content?.mimeType).toBe("text/html;profile=mcp-app");
    expect(content?.text).toBe(TEAK_APP_HTML);
    expect(content?._meta.ui).toEqual({
      csp: {
        connectDomains: [],
        resourceDomains: ["https://files.teakvault.com"],
      },
      domain: "0fbdf198a3f79fa6adb2acb582e6cc05.claudemcpcontent.com",
      prefersBorder: true,
    });
  });

  test("follows a self-hosted server's own URL and files origin", async () => {
    process.env.WORKOS_RESOURCE_ORIGIN = "https://teak.example.com";
    process.env.FILES_BASE = "https://files.teak.example.com/r2";
    const body = await read({ uri: TEAK_APP_RESOURCE_URI });
    expect(body.result?.contents[0]?._meta.ui).toMatchObject({
      csp: { resourceDomains: ["https://files.teak.example.com"] },
      domain: "049164e2df78f9ff588b380732676305.claudemcpcontent.com",
    });
  });

  test("refuses a resource it doesn't serve, and a read without a uri", async () => {
    expect((await read({ uri: "ui://teak/other.html" })).error).toEqual({
      code: -32_002,
      message: "Resource not found: ui://teak/other.html",
    });
    expect((await read({})).error?.code).toBe(-32_602);
  });

  test("lists the view without Convex", () => {
    expect(
      answerProtocolMessage({ id: 5, jsonrpc: "2.0", method: "resources/list" })
    ).toEqual({
      kind: "reply",
      reply: jsonRpcResponse(5, { resources: [TEAK_APP_RESOURCE] }),
    });
  });
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
    ["an unknown method", { id: 1, jsonrpc: "2.0", method: "prompts/list" }],
    [
      "a resource read",
      { id: 1, jsonrpc: "2.0", method: "resources/read", params: {} },
    ],
    ["a message without jsonrpc 2.0", { id: 1, method: "ping" }],
    ["a batch array", [{ id: 1, jsonrpc: "2.0", method: "ping" }]],
  ])("leaves %s to Convex", (_label, message) => {
    expect(answerProtocolMessage(message)).toEqual({ kind: "needsConvex" });
  });
});
