import { describe, expect, test } from "bun:test";
import {
  buildInitializeResult,
  MCP_CORS_HEADERS,
  TEAK_V1_TOOLS,
} from "@teak/convex/mcp/protocol";
import { handleApiProxyRequest } from "./apiProxy";
import type { EdgeIdentity } from "./edgeIdentity";
import { answerMcpAtEdge } from "./mcpEdge";

const USER: EdgeIdentity = { key: "user:teak_owner", source: "api_key" };

const mcp = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://teakvault.com/mcp", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer teakapi_key",
      "content-type": "application/json",
      ...headers,
    },
    method: "POST",
  });

const rpc = (id: number | null, method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  ...(id === null ? {} : { id }),
  method,
  ...(params === undefined ? {} : { params }),
});

describe("MCP protocol at the edge", () => {
  test("answers initialize with the client's protocol version", async () => {
    const response = await answerMcpAtEdge(
      mcp(rpc(1, "initialize", { protocolVersion: "2026-07-28" })),
      USER
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      id: 1,
      jsonrpc: "2.0",
      result: buildInitializeResult({ protocolVersion: "2026-07-28" }),
    });
    expect(buildInitializeResult({ protocolVersion: "2026-07-28" })).toEqual({
      capabilities: { tools: {} },
      protocolVersion: "2026-07-28",
      serverInfo: { name: "teak-api", version: "1.0.0" },
    });
  });

  test("lists the same tools Convex lists", async () => {
    const response = await answerMcpAtEdge(mcp(rpc(2, "tools/list")), USER);
    const body = (await response?.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toEqual(
      JSON.parse(JSON.stringify(TEAK_V1_TOOLS))
    );
  });

  test("answers ping with an empty result", async () => {
    const response = await answerMcpAtEdge(
      mcp(rpc("abc" as never, "ping")),
      USER
    );
    expect(await response?.json()).toEqual({
      id: "abc",
      jsonrpc: "2.0",
      result: {},
    });
  });

  test("acknowledges a notification with 202 and no body", async () => {
    const response = await answerMcpAtEdge(
      mcp(rpc(null, "notifications/initialized")),
      USER
    );
    expect(response?.status).toBe(202);
    expect(await response?.text()).toBe("");
    expect(response?.headers.get("content-type")).toBeNull();
  });

  test("acknowledges a batch of only notifications with 202 and no body", async () => {
    const response = await answerMcpAtEdge(
      mcp([rpc(null, "notifications/initialized")]),
      USER
    );
    expect(response?.status).toBe(202);
    expect(await response?.text()).toBe("");
  });

  test("leaves an empty batch to Convex's invalid request error", async () => {
    expect(await answerMcpAtEdge(mcp([]), USER)).toBeNull();
  });

  test("answers a protocol-only batch in order, skipping notifications", async () => {
    const response = await answerMcpAtEdge(
      mcp([
        rpc(null, "notifications/initialized"),
        rpc(1, "ping"),
        rpc(2, "ping"),
      ]),
      USER
    );
    expect(await response?.json()).toEqual([
      { id: 1, jsonrpc: "2.0", result: {} },
      { id: 2, jsonrpc: "2.0", result: {} },
    ]);
  });

  test("carries the MCP and API headers Convex adds", async () => {
    const response = await answerMcpAtEdge(mcp(rpc(1, "ping")), USER);
    for (const [name, value] of Object.entries(MCP_CORS_HEADERS)) {
      expect(response?.headers.get(name)).toBe(value);
    }
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("content-type")).toBe(
      "application/json; charset=utf-8"
    );
    expect(response?.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
  });

  test.each([
    [
      "a tool call",
      mcp(rpc(1, "tools/call", { arguments: {}, name: "teak_v1_get_me" })),
    ],
    [
      "a batch with one tool call",
      mcp([rpc(1, "ping"), rpc(2, "tools/call", { name: "x" })]),
    ],
    ["an unknown method", mcp(rpc(1, "resources/list"))],
    ["an invalid message", mcp({ id: 1, method: "ping" })],
    ["unparseable JSON", mcp("{nope")],
    [
      "a body that is not JSON",
      mcp(rpc(1, "ping"), { "content-type": "text/plain" }),
    ],
    [
      "a client that accepts no JSON",
      mcp(rpc(1, "ping"), { accept: "text/html" }),
    ],
    [
      "an oversized batch",
      mcp(Array.from({ length: 101 }, (_, id) => rpc(id, "ping"))),
    ],
  ])("leaves %s to Convex", async (_name, request) => {
    expect(await answerMcpAtEdge(request, USER)).toBeNull();
  });

  test.each([
    [
      "an unknown credential",
      { key: "ip:203.0.113.9", source: "address" } as const,
    ],
    [
      "a WorkOS user Convex has not mapped",
      { key: "workos:user_1", source: "oauth" } as const,
    ],
    ["no identity", undefined],
  ])("leaves %s to Convex", async (_name, identity) => {
    expect(await answerMcpAtEdge(mcp(rpc(1, "ping")), identity)).toBeNull();
  });
});

describe("the API proxy", () => {
  const proxy = async (request: Request, identity?: EdgeIdentity) => {
    const forwarded: string[] = [];
    const response = await handleApiProxyRequest(
      request,
      {
        API_PUBLIC_HOST: "teakvault.com",
        API_UPSTREAM_ORIGIN: "https://upstream.convex.site",
      },
      { waitUntil: () => undefined },
      {
        fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
          forwarded.push(
            `${String(input)} ${await new Response(init?.body).text()}`
          );
          return new Response("from convex", { status: 401 });
        }) as typeof fetch,
        rateLimit: () =>
          Promise.resolve({
            attestation: null,
            ...(identity ? { identity: identity as never } : {}),
          }),
      }
    );
    return { forwarded, response };
  };

  test("answers a known user's ping without reaching Convex", async () => {
    const { forwarded, response } = await proxy(mcp(rpc(1, "ping")), USER);
    expect(forwarded).toEqual([]);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-frame-options")).toBe("DENY");
  });

  test("forwards the untouched body of a request it cannot answer", async () => {
    const body = rpc(1, "tools/call", { name: "teak_v1_get_me" });
    const { forwarded, response } = await proxy(mcp(body), USER);
    expect(forwarded).toEqual([
      `https://upstream.convex.site/mcp ${JSON.stringify(body)}`,
    ]);
    expect(response?.status).toBe(401);
  });

  test("forwards an unknown credential's initialize for Convex's 401", async () => {
    const { forwarded } = await proxy(mcp(rpc(1, "initialize")));
    expect(forwarded).toHaveLength(1);
  });
});
