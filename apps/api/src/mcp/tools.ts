import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getHeaderValue } from "../shared/http.js";
import { executeGatewayOperation } from "../shared/proxy.js";

type ToolRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

type JsonObject = Record<string, unknown>;

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

const createTextContent = (text: string): CallToolResult["content"] => {
  return [{ type: "text", text }];
};

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
): CallToolResult => {
  return {
    structuredContent,
    content: createTextContent(summary),
  };
};

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
  return getHeaderValue(extra.requestInfo?.headers, "authorization");
};

const executeToolOperation = async (
  operation: Parameters<typeof executeGatewayOperation>[0],
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

  const response = await executeGatewayOperation({
    ...operation,
    headers: {
      ...(operation.headers ?? {}),
      Authorization: authorization,
    },
  });

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

const registerCreateCardTool = (server: McpServer): void => {
  server.registerTool(
    "teak_v1_create_card",
    {
      description: "Create a new card from text or a URL.",
      inputSchema: z.object({
        content: nonEmptyString,
      }),
    },
    async (input, extra) => {
      const result = await executeToolOperation(
        {
          method: "POST",
          path: "/v1/cards",
          body: {
            content: input.content,
          },
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
    }
  );
};

const registerSearchCardsTool = (server: McpServer): void => {
  server.registerTool(
    "teak_v1_search_cards",
    {
      description: "Search cards by query text.",
      inputSchema: queryInputSchema,
    },
    async (input, extra) => {
      const result = await executeToolOperation(
        {
          method: "GET",
          path: "/v1/cards/search",
          query: {
            q: input.q,
            limit: input.limit,
          },
        },
        extra
      );

      if (!result.ok) {
        return result.result;
      }

      const total =
        typeof result.payload.total === "number" ? result.payload.total : 0;
      return successResult(result.payload, `Fetched ${total} cards`);
    }
  );
};

const registerListFavoritesTool = (server: McpServer): void => {
  server.registerTool(
    "teak_v1_list_favorite_cards",
    {
      description: "List favorited cards, optionally filtered by query text.",
      inputSchema: queryInputSchema,
    },
    async (input, extra) => {
      const result = await executeToolOperation(
        {
          method: "GET",
          path: "/v1/cards/favorites",
          query: {
            q: input.q,
            limit: input.limit,
          },
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
  );
};

const registerUpdateCardTool = (server: McpServer): void => {
  server.registerTool(
    "teak_v1_update_card",
    {
      description: "Update card fields for an existing card.",
      inputSchema: updateCardInputSchema,
    },
    async (input, extra) => {
      const result = await executeToolOperation(
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
    }
  );
};

const registerSetFavoriteTool = (server: McpServer): void => {
  server.registerTool(
    "teak_v1_set_card_favorite",
    {
      description: "Set a card's favorite state.",
      inputSchema: z.object({
        cardId: nonEmptyString,
        isFavorited: z.boolean(),
      }),
    },
    async (input, extra) => {
      const result = await executeToolOperation(
        {
          method: "PATCH",
          path: `/v1/cards/${encodeURIComponent(input.cardId)}/favorite`,
          body: {
            isFavorited: input.isFavorited,
          },
        },
        extra
      );

      if (!result.ok) {
        return result.result;
      }

      const stateText = input.isFavorited ? "favorited" : "unfavorited";
      return successResult(result.payload, `Card ${stateText}`);
    }
  );
};

const registerDeleteCardTool = (server: McpServer): void => {
  server.registerTool(
    "teak_v1_delete_card",
    {
      description: "Delete a card. `confirm` must be true.",
      inputSchema: z.object({
        cardId: nonEmptyString,
        confirm: z.literal(true),
      }),
    },
    async (input, extra) => {
      const result = await executeToolOperation(
        {
          method: "DELETE",
          path: `/v1/cards/${encodeURIComponent(input.cardId)}`,
        },
        extra
      );

      if (!result.ok) {
        return result.result;
      }

      const payload = {
        status: "deleted",
        cardId: input.cardId,
      };

      return successResult(payload, `Deleted card ${input.cardId}`);
    }
  );
};

export const registerTeakV1Tools = (server: McpServer): void => {
  registerCreateCardTool(server);
  registerSearchCardsTool(server);
  registerListFavoritesTool(server);
  registerUpdateCardTool(server);
  registerSetFavoriteTool(server);
  registerDeleteCardTool(server);
};
