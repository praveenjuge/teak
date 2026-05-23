import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "hono";
import { json } from "../shared/http.js";
import { registerTeakV1Tools } from "./tools.js";

const server = new McpServer({
  name: "teak-api",
  version: "1.0.0",
});

const transport = new StreamableHTTPTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
});

registerTeakV1Tools(server);

let connectPromise: Promise<void> | null = null;

const ensureConnected = async (): Promise<void> => {
  if (server.isConnected()) {
    return;
  }

  if (!connectPromise) {
    connectPromise = server.connect(transport).finally(() => {
      connectPromise = null;
    });
  }

  await connectPromise;
};

export const handleMcpRequest = async (c: Context): Promise<Response> => {
  await ensureConnected();
  const response = await transport.handleRequest(c);

  return (
    response ??
    json(500, {
      code: "INTERNAL_ERROR",
      error: "Failed to handle MCP request",
    })
  );
};
