import { describe, expect, mock, test } from "bun:test";
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
