import {
  answerProtocolMessage,
  MAX_MCP_JSON_RPC_BATCH,
  MCP_CORS_HEADERS,
} from "@teak/convex/mcp/protocol";
import { readResponseTextWithinLimit } from "@teak/convex/shared/boundedResponse";
import { PUBLIC_API_CORS_HEADERS } from "@teak/convex/shared/publicApiHeaders";
import type { EdgeIdentity } from "./edgeIdentity";

export const MCP_EDGE_MAX_BODY_BYTES = 64 * 1024;

type JsonObject = Record<string, unknown>;

const mcpResponse = (status: number, body: unknown): Response => {
  const headers = new Headers(
    body === undefined
      ? {}
      : {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
        }
  );
  for (const [name, value] of Object.entries(PUBLIC_API_CORS_HEADERS)) {
    headers.set(name, value);
  }
  headers.set("X-Request-Id", crypto.randomUUID());
  for (const [name, value] of Object.entries(MCP_CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(body === undefined ? null : JSON.stringify(body), {
    headers,
    status,
  });
};

const acceptsJson = (request: Request): boolean => {
  const accept = request.headers.get("accept") ?? "*/*";
  return (
    accept.includes("application/json") ||
    accept.includes("text/event-stream") ||
    accept.includes("*/*")
  );
};

export const answerMcpAtEdge = async (
  request: Request,
  identity: EdgeIdentity | undefined
): Promise<Response | null> => {
  if (
    !identity?.key.startsWith("user:") ||
    request.method !== "POST" ||
    !acceptsJson(request) ||
    !request.headers.get("content-type")?.includes("application/json")
  ) {
    return null;
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MCP_EDGE_MAX_BODY_BYTES) {
    return null;
  }
  const text = await readResponseTextWithinLimit(
    new Response(request.clone().body),
    MCP_EDGE_MAX_BODY_BYTES
  );
  if (text === null) {
    return null;
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(body) && body.length > MAX_MCP_JSON_RPC_BATCH) {
    return null;
  }
  const messages = Array.isArray(body) ? body : [body];
  const replies: JsonObject[] = [];
  for (const message of messages) {
    const answer = answerProtocolMessage(message);
    if (answer.kind === "needsConvex") {
      return null;
    }
    if (answer.kind === "reply") {
      replies.push(answer.reply);
    }
  }
  // Only notifications, single or batched, get no body.
  if (replies.length === 0) {
    return mcpResponse(202, undefined);
  }
  return mcpResponse(200, Array.isArray(body) ? replies : replies[0]);
};
