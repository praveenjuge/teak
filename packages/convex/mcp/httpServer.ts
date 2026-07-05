import { httpAction } from "../_generated/server";
import {
  buildProtectedResourceMetadata,
  getProtectedResourceUrl,
  json,
  withPublicApiGatewayHeaders,
} from "../publicApiMeta";
import {
  executePublicApiOperation,
  type PublicApiOperation,
  validatePublicApiBearer,
} from "../publicApiHttp";
import { callTeakV1Tool, TEAK_V1_TOOLS } from "./tools";

type JsonObject = Record<string, unknown>;

const MCP_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

const TOKEN_VALIDATION_TTL_MS = 30_000;
const MAX_VALIDATED_TOKENS = 10_000;
const validatedTokenCache = new Map<string, number>();

const getAuthorizationHeader = (request: Request): string | null =>
  request.headers.get("authorization");

const hasFreshValidation = (authorization: string, now: number): boolean => {
  const expiresAt = validatedTokenCache.get(authorization);
  if (!expiresAt) {
    return false;
  }

  if (expiresAt <= now) {
    validatedTokenCache.delete(authorization);
    return false;
  }

  return true;
};

const rememberValidation = (authorization: string, now: number): void => {
  validatedTokenCache.set(authorization, now + TOKEN_VALIDATION_TTL_MS);

  for (const [cachedAuthorization, expiresAt] of validatedTokenCache) {
    if (expiresAt <= now) {
      validatedTokenCache.delete(cachedAuthorization);
    }
  }

  if (validatedTokenCache.size <= MAX_VALIDATED_TOKENS) {
    return;
  }

  const overflow = validatedTokenCache.size - MAX_VALIDATED_TOKENS;
  let removed = 0;
  for (const cachedAuthorization of validatedTokenCache.keys()) {
    validatedTokenCache.delete(cachedAuthorization);
    removed += 1;
    if (removed >= overflow) {
      return;
    }
  }
};

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

const withAuthChallenge = (response: Response, requestUrl: string): Response => {
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

const metadataResponse = (request: Request): Response =>
  withMcpCors(json(200, buildProtectedResourceMetadata(request.url)));

export const handleOauthProtectedResourceV1Request = async (
  request: Request
): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return corsPreflight();
  }
  return metadataResponse(request);
};

export const oauthProtectedResourceV1 = httpAction(async (_ctx, request) =>
  handleOauthProtectedResourceV1Request(request)
);

const executeToolOperation = (
  ctx: any,
  request: Request,
  operation: PublicApiOperation
): Promise<Response> =>
  executePublicApiOperation(ctx, {
    ...operation,
    origin: new URL(request.url).origin,
  });

const jsonRpcResponse = (id: unknown, result: unknown): JsonObject => ({
  jsonrpc: "2.0",
  id: id ?? null,
  result,
});

const jsonRpcError = (
  id: unknown,
  code: number,
  message: string
): JsonObject => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

const parseJsonRpcBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const handleJsonRpcMessage = async (
  ctx: any,
  request: Request,
  message: unknown
): Promise<JsonObject | null> => {
  if (!(message && typeof message === "object" && !Array.isArray(message))) {
    return jsonRpcError(null, -32_700, "Parse error");
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

  if (rpc.method.startsWith("notifications/")) {
    return null;
  }

  if (rpc.method === "initialize") {
    return jsonRpcResponse(rpc.id, {
      protocolVersion:
        typeof (rpc.params as { protocolVersion?: unknown } | null)
          ?.protocolVersion === "string"
          ? (rpc.params as { protocolVersion: string }).protocolVersion
          : "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "teak-api", version: "1.0.0" },
    });
  }

  if (rpc.method === "tools/list") {
    return jsonRpcResponse(rpc.id, { tools: TEAK_V1_TOOLS });
  }

  if (rpc.method === "tools/call") {
    const params = rpc.params as
      | { arguments?: unknown; name?: unknown }
      | null
      | undefined;
    if (!(params && typeof params.name === "string")) {
      return jsonRpcError(rpc.id, -32_602, "Invalid params");
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

const handleMcpPost = async (ctx: any, request: Request): Promise<Response> => {
  const accept = request.headers.get("accept") ?? "*/*";
  if (
    !(accept.includes("application/json") ||
      accept.includes("text/event-stream") ||
      accept.includes("*/*"))
  ) {
    return json(406, jsonRpcError(null, -32_000, "Not Acceptable"));
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json(415, jsonRpcError(null, -32_000, "Unsupported Media Type"));
  }

  const body = await parseJsonRpcBody(request);
  const messages = Array.isArray(body) ? body : [body];
  const responses: JsonObject[] = [];
  for (const message of messages) {
    const response = await handleJsonRpcMessage(ctx, request, message);
    if (response) {
      responses.push(response);
    }
  }

  if (Array.isArray(body)) {
    return json(200, responses);
  }

  if (responses.length === 0) {
    return new Response(null, { status: 202 });
  }

  return json(200, responses[0]);
};

const validateMcpBearer = async (
  ctx: any,
  request: Request
): Promise<Response | null> => {
  const authorization = getAuthorizationHeader(request);
  const now = Date.now();
  if (authorization && hasFreshValidation(authorization, now)) {
    return null;
  }

  const authError = await validatePublicApiBearer(ctx, request);
  if (authError) {
    return authError.status === 401
      ? withAuthChallenge(authError, request.url)
      : withMcpCors(authError);
  }

  if (authorization) {
    rememberValidation(authorization, now);
  }

  return null;
};

export const handleMcpV1Request = async (
  ctx: any,
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
