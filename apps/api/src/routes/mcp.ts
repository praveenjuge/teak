import type { Hono, MiddlewareHandler } from "hono";
import { handleMcpRequest } from "../mcp/server.js";
import { json, parseBearerToken } from "../shared/http.js";
import { executeGatewayOperation } from "../shared/proxy.js";

const MCP_UNAUTHORIZED_PAYLOAD = {
  code: "UNAUTHORIZED",
  error: "Missing or invalid Authorization header",
};
const TOKEN_VALIDATION_TTL_MS = 30_000;
const MAX_VALIDATED_TOKENS = 10_000;
const validatedTokenCache = new Map<string, number>();

const validateApiKey = async (
  authorization: string
): Promise<Response | null> => {
  const response = await executeGatewayOperation({
    method: "GET",
    path: "/v1/cards/search",
    query: { limit: 1 },
    headers: { Authorization: authorization },
  });

  return response.ok ? null : response;
};

const hasFreshValidation = (token: string, now: number): boolean => {
  const expiresAt = validatedTokenCache.get(token);
  if (!expiresAt) {
    return false;
  }

  if (expiresAt <= now) {
    validatedTokenCache.delete(token);
    return false;
  }

  return true;
};

const pruneValidationCache = (now: number): void => {
  for (const [token, expiresAt] of validatedTokenCache) {
    if (expiresAt <= now) {
      validatedTokenCache.delete(token);
    }
  }

  if (validatedTokenCache.size <= MAX_VALIDATED_TOKENS) {
    return;
  }

  const overflow = validatedTokenCache.size - MAX_VALIDATED_TOKENS;
  let removed = 0;
  for (const token of validatedTokenCache.keys()) {
    validatedTokenCache.delete(token);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
};

const requireMcpBearer: MiddlewareHandler = async (c, next) => {
  const token = parseBearerToken(c.req.header("authorization") ?? null);
  if (!token) {
    return json(401, MCP_UNAUTHORIZED_PAYLOAD);
  }

  const now = Date.now();
  if (!hasFreshValidation(token, now)) {
    const authError = await validateApiKey(`Bearer ${token}`);
    if (authError) {
      return authError;
    }

    validatedTokenCache.set(token, now + TOKEN_VALIDATION_TTL_MS);
    pruneValidationCache(now);
  }

  await next();
};

export const registerMcpRoutes = (app: Hono): void => {
  app.use("/mcp", requireMcpBearer);
  app.use("/mcp/", requireMcpBearer);

  app.all("/mcp", handleMcpRequest);
  app.all("/mcp/", handleMcpRequest);
};
