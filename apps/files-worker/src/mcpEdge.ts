import {
  answerProtocolMessage,
  MAX_MCP_JSON_RPC_BATCH,
  MCP_CORS_HEADERS,
} from "@teak/convex/mcp/protocol";
import { readResponseTextWithinLimit } from "@teak/convex/shared/bounded-response";
import { PUBLIC_API_CORS_HEADERS } from "@teak/convex/shared/publicApiHeaders";
import type { EdgeIdentity } from "./edgeIdentity";

/**
 * MCP clients open every session with `initialize`, a
 * `notifications/initialized`, `tools/list` and periodic `ping`s, none of
 * which need Convex. For a request the edge has tied to a Teak user and
 * charged to their limit, this answers those messages here with the same
 * builders and the same response shape as Convex (packages/convex/mcp/
 * protocol.ts and httpServer.ts). Anything else, including a batch with one
 * tool call, any request Convex would refuse (wrong Accept or Content-Type,
 * unparseable, too large, too many messages) and every request without a
 * known user, is forwarded unchanged and Convex answers it as before.
 *
 * The edge knows a credential's owner from a cache that may lag a revoked
 * key by a few minutes (edgeIdentity.ts); these answers carry nothing about
 * the account, and every tool call is still authenticated by Convex.
 */

/** Protocol chatter is tiny; a larger body goes to Convex. */
export const MCP_EDGE_MAX_BODY_BYTES = 64 * 1024;

type JsonObject = Record<string, unknown>;

/** Convex's `withMcpCors(json(...))`, built from the same header sets. */
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

/**
 * The edge's answer, or null to forward the request to Convex. Reads a copy
 * of the body, so a forwarded request still carries its own.
 */
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
    const reply = answerProtocolMessage(message);
    if (reply === undefined) {
      return null;
    }
    if (reply) {
      replies.push(reply);
    }
  }
  if (Array.isArray(body)) {
    return mcpResponse(200, replies);
  }
  return replies.length === 0
    ? mcpResponse(202, undefined)
    : mcpResponse(200, replies[0]);
};
