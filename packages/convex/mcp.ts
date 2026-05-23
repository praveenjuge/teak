import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { httpAction } from "./_generated/server";
import {
  authorizePublicApiRequest,
  errorResponse,
  handlePublicApiRequest,
  type PublicApiCtx,
  json,
} from "./publicApiHttp";
import { trackMcpToolInvocation } from "./shared/metrics";

type ToolRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type JsonObject = Record<string, unknown>;

type GatewayOperation = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

const MCP_UNAUTHORIZED_MESSAGE = "Missing or invalid Authorization header";

const queryInputSchema = z.object({
  q: z.string().optional(),
  limit: z.number().int().optional(),
});

const nonEmptyString = z.string().trim().min(1);

const updateCardInputSchema = z
  .object({
    cardId: nonEmptyString,
    content: nonEmptyString.optional(),
    url: nonEmptyString.optional(),
    notes: z.string().or(z.null()).optional(),
    tags: z.array(z.string()).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.content === undefined &&
      value.url === undefined &&
      value.notes === undefined &&
      value.tags === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "At least one field must be provided: content, url, notes, tags",
        path: ["content"],
      });
    }
  });

const createTextContent = (text: string): CallToolResult["content"] => [
  { type: "text", text },
];

const toObjectPayload = (payload: unknown): JsonObject => {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as JsonObject;
  }

  return {};
};

const parseResponsePayload = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
};

const successResult = (
  structuredContent: JsonObject,
  summary: string
): CallToolResult => ({
  structuredContent,
  content: createTextContent(summary),
});

const errorResult = (status: number, payload: unknown): CallToolResult => {
  const objectPayload = toObjectPayload(payload);
  const code =
    typeof objectPayload.code === "string"
      ? objectPayload.code
      : "INTERNAL_ERROR";
  const error =
    typeof objectPayload.error === "string"
      ? objectPayload.error
      : `Request failed with status ${status}`;

  return {
    isError: true,
    structuredContent: {
      ...objectPayload,
      status,
      code,
      error,
    },
    content: createTextContent(`${code}: ${error}`),
  };
};

const getAuthorizationHeader = (extra: ToolRequestExtra): string | null => {
  const headers = extra.requestInfo?.headers;
  if (!headers) {
    return null;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "authorization") {
      continue;
    }

    return Array.isArray(value) ? value.join(", ") : (value ?? null);
  }

  return null;
};

type ToolHandler<TInput> = (
  input: TInput,
  extra: ToolRequestExtra
) => Promise<CallToolResult>;

const instrumentToolHandler =
  <TInput>(
    toolName: string,
    handler: ToolHandler<TInput>
  ): ToolHandler<TInput> =>
  async (input, extra) => {
    const start = Date.now();
    let outcome: "ok" | "error" | "unauthorized" = "ok";
    let status: number | undefined;
    try {
      const result = await handler(input, extra);
      if (result.isError) {
        const structured = result.structuredContent as
          | { status?: unknown }
          | undefined;
        status =
          typeof structured?.status === "number" ? structured.status : 500;
        outcome = status === 401 ? "unauthorized" : "error";
      }
      return result;
    } catch (error) {
      outcome = "error";
      throw error;
    } finally {
      trackMcpToolInvocation({
        tool: toolName,
        outcome,
        durationMs: Date.now() - start,
        status,
      });
    }
  };

const executeToolOperation = async (
  ctx: PublicApiCtx,
  baseUrl: string,
  operation: GatewayOperation,
  extra: ToolRequestExtra
): Promise<
  { ok: true; payload: JsonObject } | { ok: false; result: CallToolResult }
> => {
  const authorization = getAuthorizationHeader(extra);
  if (!authorization) {
    return {
      ok: false,
      result: errorResult(401, {
        code: "UNAUTHORIZED",
        error: MCP_UNAUTHORIZED_MESSAGE,
      }),
    };
  }

  const url = new URL(operation.path, baseUrl);
  for (const [key, value] of Object.entries(operation.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await handlePublicApiRequest(
    ctx,
    new Request(url.toString(), {
      method: operation.method,
      headers: {
        Authorization: authorization,
        ...(operation.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        operation.body === undefined ? undefined : JSON.stringify(operation.body),
    })
  );

  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    return {
      ok: false,
      result: errorResult(response.status, payload),
    };
  }

  return {
    ok: true,
    payload: toObjectPayload(payload),
  };
};

const registerTeakV1Tools = (
  server: McpServer,
  ctx: PublicApiCtx,
  baseUrl: string
): void => {
  server.registerTool(
    "teak_v1_create_card",
    {
      description: "Create a new card from text or a URL.",
      inputSchema: z.object({
        content: nonEmptyString,
      }),
    },
    instrumentToolHandler("teak_v1_create_card", async (input, extra) => {
      const result = await executeToolOperation(
        ctx,
        baseUrl,
        {
          method: "POST",
          path: "/v1/cards",
          body: { content: input.content },
        },
        extra
      );

      if (!result.ok) {
        return result.result;
      }

      const status =
        typeof result.payload.status === "string"
          ? result.payload.status
          : "created";
      return successResult(result.payload, `Card ${status}`);
    })
  );

  server.registerTool(
    "teak_v1_search_cards",
    {
      description: "Search cards by query text.",
      inputSchema: queryInputSchema,
    },
    instrumentToolHandler("teak_v1_search_cards", async (input, extra) => {
      const result = await executeToolOperation(
        ctx,
        baseUrl,
        {
          method: "GET",
          path: "/v1/cards/search",
          query: { q: input.q, limit: input.limit },
        },
        extra
      );

      if (!result.ok) {
        return result.result;
      }

      const total =
        typeof result.payload.total === "number" ? result.payload.total : 0;
      return successResult(result.payload, `Fetched ${total} cards`);
    })
  );

  server.registerTool(
    "teak_v1_list_favorite_cards",
    {
      description: "List favorited cards, optionally filtered by query text.",
      inputSchema: queryInputSchema,
    },
    instrumentToolHandler(
      "teak_v1_list_favorite_cards",
      async (input, extra) => {
        const result = await executeToolOperation(
          ctx,
          baseUrl,
          {
            method: "GET",
            path: "/v1/cards/favorites",
            query: { q: input.q, limit: input.limit },
          },
          extra
        );

        if (!result.ok) {
          return result.result;
        }

        const total =
          typeof result.payload.total === "number" ? result.payload.total : 0;
        return successResult(result.payload, `Fetched ${total} favorite cards`);
      }
    )
  );

  server.registerTool(
    "teak_v1_update_card",
    {
      description: "Update card fields for an existing card.",
      inputSchema: updateCardInputSchema,
    },
    instrumentToolHandler("teak_v1_update_card", async (input, extra) => {
      const result = await executeToolOperation(
        ctx,
        baseUrl,
        {
          method: "PATCH",
          path: `/v1/cards/${encodeURIComponent(input.cardId)}`,
          body: {
            ...(input.content === undefined ? {} : { content: input.content }),
            ...(input.url === undefined ? {} : { url: input.url }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            ...(input.tags === undefined ? {} : { tags: input.tags }),
          },
        },
        extra
      );

      if (!result.ok) {
        return result.result;
      }

      return successResult(result.payload, "Card updated");
    })
  );

  server.registerTool(
    "teak_v1_set_card_favorite",
    {
      description: "Set a card's favorite state.",
      inputSchema: z.object({
        cardId: nonEmptyString,
        isFavorited: z.boolean(),
      }),
    },
    instrumentToolHandler("teak_v1_set_card_favorite", async (input, extra) => {
      const result = await executeToolOperation(
        ctx,
        baseUrl,
        {
          method: "PATCH",
          path: `/v1/cards/${encodeURIComponent(input.cardId)}/favorite`,
          body: { isFavorited: input.isFavorited },
        },
        extra
      );

      if (!result.ok) {
        return result.result;
      }

      const stateText = input.isFavorited ? "favorited" : "unfavorited";
      return successResult(result.payload, `Card ${stateText}`);
    })
  );

  server.registerTool(
    "teak_v1_delete_card",
    {
      description: "Delete a card. `confirm` must be true.",
      inputSchema: z.object({
        cardId: nonEmptyString,
        confirm: z.literal(true),
      }),
    },
    instrumentToolHandler("teak_v1_delete_card", async (input, extra) => {
      const result = await executeToolOperation(
        ctx,
        baseUrl,
        {
          method: "DELETE",
          path: `/v1/cards/${encodeURIComponent(input.cardId)}`,
        },
        extra
      );

      if (!result.ok) {
        return result.result;
      }

      const payload = { status: "deleted", cardId: input.cardId };
      return successResult(payload, `Deleted card ${input.cardId}`);
    })
  );
};

const createMcpServer = (ctx: PublicApiCtx, requestUrl: string): McpServer => {
  const server = new McpServer({
    name: "teak-api",
    version: "1.0.0",
  });

  registerTeakV1Tools(server, ctx, new URL(requestUrl).origin);
  return server;
};

export const mcpV1 = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  const auth = await authorizePublicApiRequest(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  const server = createMcpServer(ctx, request.url);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch {
    return json(500, {
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal server error",
      },
      id: null,
    });
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
});
