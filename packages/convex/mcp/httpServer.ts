import { type ActionCtx, httpAction } from "../_generated/server";
import {
  buildProtectedResourceMetadata,
  getProtectedResourceUrl,
  json,
  withPublicApiGatewayHeaders,
} from "../publicApi/http/meta";
import {
  executePublicApiOperation,
  type PublicApiOperation,
  validatePublicApiBearer,
} from "../publicApi/http/routes";
import {
  answerProtocolMessage,
  jsonRpcError,
  jsonRpcResponse,
  MAX_MCP_JSON_RPC_BATCH,
  MCP_CORS_HEADERS,
} from "./protocol";
import { callTeakV1Tool, isTeakV1Tool } from "./tools";

type JsonObject = Record<string, unknown>;

const JSON_RPC_RATE_LIMITED_CODE = -32_000;

const withMcpCors = (response: Response): Response => {
  const withGatewayHeaders = withPublicApiGatewayHeaders(response);
  const headers = new Headers(withGatewayHeaders.headers);
  for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(withGatewayHeaders.body, {
    status: withGatewayHeaders.status,
    statusText: withGatewayHeaders.statusText,
    headers,
  });
};

const withAuthChallenge = (
  response: Response,
  requestUrl: string
): Response => {
  const challenged = withMcpCors(response);
  const headers = new Headers(challenged.headers);
  headers.set(
    "WWW-Authenticate",
    `Bearer resource_metadata="${getProtectedResourceUrl(requestUrl)}"`
  );
  return new Response(challenged.body, {
    status: challenged.status,
    statusText: challenged.statusText,
    headers,
  });
};

const corsPreflight = (): Response =>
  withMcpCors(new Response(null, { status: 204 }));

const metadataResponse = (): Response =>
  withMcpCors(json(200, buildProtectedResourceMetadata()));

export const handleOauthProtectedResourceV1Request = (
  request: Request
): Response => {
  if (request.method === "OPTIONS") {
    return corsPreflight();
  }
  return metadataResponse();
};

export const oauthProtectedResourceV1 = httpAction(async (_ctx, request) =>
  handleOauthProtectedResourceV1Request(request)
);

const executeToolOperation = (
  ctx: ActionCtx,
  request: Request,
  operation: PublicApiOperation
): Promise<Response> =>
  executePublicApiOperation(
    ctx,
    {
      ...operation,
      origin: new URL(request.url).origin,
    },
    "mcp"
  );

const PARSE_ERROR = Symbol("parse error");

const parseJsonRpcBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return PARSE_ERROR;
  }
};

const handleJsonRpcMessage = async (
  ctx: ActionCtx,
  request: Request,
  message: unknown
): Promise<JsonObject | null> => {
  if (!(message && typeof message === "object" && !Array.isArray(message))) {
    return jsonRpcError(null, -32_600, "Invalid Request");
  }

  const rpc = message as {
    id?: null | number | string;
    jsonrpc?: string;
    method?: string;
    params?: unknown;
  };
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    return jsonRpcError(rpc.id, -32_600, "Invalid Request");
  }

  const answered = answerProtocolMessage(rpc);
  if (answered.kind === "reply") {
    return answered.reply;
  }
  if (answered.kind === "noReply") {
    return null;
  }

  if (rpc.method === "tools/call") {
    const params = rpc.params as
      | { arguments?: unknown; name?: unknown }
      | null
      | undefined;
    if (!(params && typeof params.name === "string")) {
      return jsonRpcError(rpc.id, -32_602, "Invalid params");
    }
    // MCP treats an unknown tool as a protocol error, not a tool result.
    if (!isTeakV1Tool(params.name)) {
      return jsonRpcError(rpc.id, -32_602, `Unknown tool: ${params.name}`);
    }

    const result = await callTeakV1Tool(
      params.name,
      params.arguments ?? {},
      request,
      (operation) => executeToolOperation(ctx, request, operation)
    );
    return jsonRpcResponse(rpc.id, result);
  }

  return jsonRpcError(rpc.id, -32_601, "Method not found");
};

const jsonRpcId = (message: unknown): null | number | string => {
  if (!(message && typeof message === "object" && !Array.isArray(message))) {
    return null;
  }
  const id = (message as { id?: unknown }).id;
  if (typeof id === "number" || typeof id === "string") {
    return id;
  }
  return null;
};

const isNotification = (message: unknown): boolean => {
  if (!(message && typeof message === "object" && !Array.isArray(message))) {
    return false;
  }
  return !("id" in message);
};

export const rateLimitedJsonRpcRemainder = (
  remainingMessages: unknown[]
): JsonObject[] =>
  remainingMessages.flatMap((message) =>
    isNotification(message)
      ? []
      : [
          jsonRpcError(
            jsonRpcId(message),
            JSON_RPC_RATE_LIMITED_CODE,
            "Rate limited"
          ),
        ]
  );

const isRateLimitedRpc = (response: JsonObject): boolean => {
  const result = response.result as
    | { isError?: boolean; structuredContent?: { status?: unknown } }
    | undefined;
  return result?.structuredContent?.status === 429;
};

const handleMcpPost = async (
  ctx: ActionCtx,
  request: Request
): Promise<Response> => {
  const accept = request.headers.get("accept") ?? "*/*";
  if (
    !(
      accept.includes("application/json") ||
      accept.includes("text/event-stream") ||
      accept.includes("*/*")
    )
  ) {
    return json(406, jsonRpcError(null, -32_000, "Not Acceptable"));
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json(415, jsonRpcError(null, -32_000, "Unsupported Media Type"));
  }

  const body = await parseJsonRpcBody(request);
  // Streamable HTTP answers a body it can't accept with an HTTP error status.
  if (body === PARSE_ERROR) {
    return json(400, jsonRpcError(null, -32_700, "Parse error"));
  }
  if (Array.isArray(body) && body.length > MAX_MCP_JSON_RPC_BATCH) {
    return json(
      400,
      jsonRpcError(
        null,
        -32_600,
        `JSON-RPC batch exceeds ${MAX_MCP_JSON_RPC_BATCH} messages`
      )
    );
  }

  // JSON-RPC answers an empty batch with one Invalid Request error.
  if (Array.isArray(body) && body.length === 0) {
    return json(400, jsonRpcError(null, -32_600, "Invalid Request"));
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses: JsonObject[] = [];
  let rateLimited = false;
  for (const message of messages) {
    if (rateLimited) {
      if (!isNotification(message)) {
        responses.push(...rateLimitedJsonRpcRemainder([message]));
      }
      continue;
    }

    const response = await handleJsonRpcMessage(ctx, request, message);
    if (response) {
      responses.push(response);
      if (isRateLimitedRpc(response)) {
        rateLimited = true;
      }
    }
  }

  // Only notifications or responses, single or batched, get no body.
  if (responses.length === 0) {
    return new Response(null, { status: 202 });
  }

  return json(200, Array.isArray(body) ? responses : responses[0]);
};

const validateMcpBearer = async (
  ctx: ActionCtx,
  request: Request
): Promise<Response | null> => {
  const authError = await validatePublicApiBearer(ctx, request, "mcp");
  if (authError) {
    return authError.status === 401
      ? withAuthChallenge(authError, request.url)
      : withMcpCors(authError);
  }

  return null;
};

export const handleMcpV1Request = async (
  ctx: ActionCtx,
  request: Request
): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return corsPreflight();
  }

  const authError = await validateMcpBearer(ctx, request);
  if (authError) {
    return authError;
  }

  if (request.method !== "POST") {
    return withMcpCors(
      json(405, jsonRpcError(null, -32_000, "Method not allowed"), {
        Allow: "POST, OPTIONS",
      })
    );
  }

  try {
    return withMcpCors(await handleMcpPost(ctx, request));
  } catch {
    return withMcpCors(
      json(500, {
        code: "INTERNAL_ERROR",
        error: "Failed to handle MCP request",
      })
    );
  }
};

export const mcpV1 = httpAction(handleMcpV1Request);
