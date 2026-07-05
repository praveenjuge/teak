import { z } from "zod";
import { trackMcpToolInvocation } from "../shared/metrics";

type JsonObject = Record<string, unknown>;
type QueryValue = boolean | number | string | undefined;

export interface PublicApiToolOperation {
  body?: unknown;
  headers?: HeadersInit;
  method: "DELETE" | "GET" | "PATCH" | "POST";
  path: string;
  query?: Record<string, QueryValue>;
}

export type PublicApiToolExecutor = (
  operation: PublicApiToolOperation
) => Promise<Response>;

export interface JsonRpcRequest {
  id?: null | number | string;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
}

interface McpToolResult {
  content: Array<{ text: string; type: "text" }>;
  isError?: boolean;
  structuredContent?: JsonObject;
}

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

const createTextContent = (text: string): McpToolResult["content"] => [
  { type: "text", text },
];

const inputSchema = (properties: JsonObject, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const TEAK_V1_TOOLS = [
  {
    name: "teak_v1_create_card",
    description: "Create a new card from text or a URL.",
    inputSchema: inputSchema(
      { content: { type: "string", minLength: 1 } },
      ["content"]
    ),
  },
  {
    name: "teak_v1_search_cards",
    description: "Search cards by query text.",
    inputSchema: inputSchema({
      q: { type: "string" },
      limit: { type: "integer" },
    }),
  },
  {
    name: "teak_v1_list_favorite_cards",
    description: "List favorited cards, optionally filtered by query text.",
    inputSchema: inputSchema({
      q: { type: "string" },
      limit: { type: "integer" },
    }),
  },
  {
    name: "teak_v1_update_card",
    description: "Update card fields for an existing card.",
    inputSchema: inputSchema(
      {
        cardId: { type: "string", minLength: 1 },
        content: { type: "string", minLength: 1 },
        url: { type: "string", minLength: 1 },
        notes: { type: ["string", "null"] },
        tags: { type: "array", items: { type: "string" } },
      },
      ["cardId"]
    ),
  },
  {
    name: "teak_v1_set_card_favorite",
    description: "Set a card's favorite state.",
    inputSchema: inputSchema(
      {
        cardId: { type: "string", minLength: 1 },
        isFavorited: { type: "boolean" },
      },
      ["cardId", "isFavorited"]
    ),
  },
  {
    name: "teak_v1_delete_card",
    description: "Delete a card. `confirm` must be true.",
    inputSchema: inputSchema(
      {
        cardId: { type: "string", minLength: 1 },
        confirm: { const: true },
      },
      ["cardId", "confirm"]
    ),
  },
] as const;

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
): McpToolResult => ({
  structuredContent,
  content: createTextContent(summary),
});

const errorResult = (status: number, payload: unknown): McpToolResult => {
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

const validationError = (message: string): McpToolResult =>
  errorResult(400, {
    code: "INVALID_INPUT",
    error: message,
  });

const getAuthorizationHeader = (request: Request): string | null =>
  request.headers.get("authorization");

type ToolHandler<TInput> = (
  input: TInput,
  request: Request
) => Promise<McpToolResult>;

const instrumentToolHandler =
  <TInput>(
    toolName: string,
    handler: ToolHandler<TInput>
  ): ToolHandler<TInput> =>
  async (input, request) => {
    const start = Date.now();
    let outcome: "ok" | "error" | "unauthorized" = "ok";
    let status: number | undefined;
    try {
      const result = await handler(input, request);
      if (result.isError) {
        const structured = result.structuredContent as
          | { status?: unknown }
          | undefined;
        status =
          typeof structured?.status === "number" ? structured.status : 500;
        outcome = status === 401 ? "unauthorized" : "error";
      }
      return result;
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
  operation: PublicApiToolOperation,
  request: Request,
  executor: PublicApiToolExecutor
): Promise<
  { ok: true; payload: JsonObject } | { ok: false; result: McpToolResult }
> => {
  const authorization = getAuthorizationHeader(request);
  if (!authorization) {
    return {
      ok: false,
      result: errorResult(401, {
        code: "UNAUTHORIZED",
        error: MCP_UNAUTHORIZED_MESSAGE,
      }),
    };
  }

  const response = await executor({
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

const toolHandlers = (executor: PublicApiToolExecutor) => ({
  teak_v1_create_card: instrumentToolHandler(
    "teak_v1_create_card",
    async (input: unknown, request) => {
      const parsed = z.object({ content: nonEmptyString }).safeParse(input);
      if (!parsed.success) {
        return validationError(parsed.error.issues[0]?.message ?? "Invalid input");
      }

      const result = await executeToolOperation(
        {
          method: "POST",
          path: "/v1/cards",
          body: {
            content: parsed.data.content,
          },
        },
        request,
        executor
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
  ),
  teak_v1_search_cards: instrumentToolHandler(
    "teak_v1_search_cards",
    async (input: unknown, request) => {
      const parsed = queryInputSchema.safeParse(input);
      if (!parsed.success) {
        return validationError(parsed.error.issues[0]?.message ?? "Invalid input");
      }

      const result = await executeToolOperation(
        {
          method: "GET",
          path: "/v1/cards/search",
          query: {
            q: parsed.data.q,
            limit: parsed.data.limit,
          },
        },
        request,
        executor
      );

      if (!result.ok) {
        return result.result;
      }

      const total =
        typeof result.payload.total === "number" ? result.payload.total : 0;
      return successResult(result.payload, `Fetched ${total} cards`);
    }
  ),
  teak_v1_list_favorite_cards: instrumentToolHandler(
    "teak_v1_list_favorite_cards",
    async (input: unknown, request) => {
      const parsed = queryInputSchema.safeParse(input);
      if (!parsed.success) {
        return validationError(parsed.error.issues[0]?.message ?? "Invalid input");
      }

      const result = await executeToolOperation(
        {
          method: "GET",
          path: "/v1/cards/favorites",
          query: {
            q: parsed.data.q,
            limit: parsed.data.limit,
          },
        },
        request,
        executor
      );

      if (!result.ok) {
        return result.result;
      }

      const total =
        typeof result.payload.total === "number" ? result.payload.total : 0;
      return successResult(result.payload, `Fetched ${total} favorite cards`);
    }
  ),
  teak_v1_update_card: instrumentToolHandler(
    "teak_v1_update_card",
    async (input: unknown, request) => {
      const parsed = updateCardInputSchema.safeParse(input);
      if (!parsed.success) {
        return validationError(parsed.error.issues[0]?.message ?? "Invalid input");
      }

      const result = await executeToolOperation(
        {
          method: "PATCH",
          path: `/v1/cards/${encodeURIComponent(parsed.data.cardId)}`,
          body: {
            ...(parsed.data.content === undefined
              ? {}
              : { content: parsed.data.content }),
            ...(parsed.data.url === undefined ? {} : { url: parsed.data.url }),
            ...(parsed.data.notes === undefined
              ? {}
              : { notes: parsed.data.notes }),
            ...(parsed.data.tags === undefined
              ? {}
              : { tags: parsed.data.tags }),
          },
        },
        request,
        executor
      );

      return result.ok
        ? successResult(result.payload, "Card updated")
        : result.result;
    }
  ),
  teak_v1_set_card_favorite: instrumentToolHandler(
    "teak_v1_set_card_favorite",
    async (input: unknown, request) => {
      const parsed = z
        .object({ cardId: nonEmptyString, isFavorited: z.boolean() })
        .safeParse(input);
      if (!parsed.success) {
        return validationError(parsed.error.issues[0]?.message ?? "Invalid input");
      }

      const result = await executeToolOperation(
        {
          method: "PATCH",
          path: `/v1/cards/${encodeURIComponent(parsed.data.cardId)}/favorite`,
          body: {
            isFavorited: parsed.data.isFavorited,
          },
        },
        request,
        executor
      );

      if (!result.ok) {
        return result.result;
      }

      const stateText = parsed.data.isFavorited ? "favorited" : "unfavorited";
      return successResult(result.payload, `Card ${stateText}`);
    }
  ),
  teak_v1_delete_card: instrumentToolHandler(
    "teak_v1_delete_card",
    async (input: unknown, request) => {
      if (!(toObjectPayload(input).confirm === true)) {
        return validationError("confirm must be true");
      }

      const parsed = z
        .object({ cardId: nonEmptyString, confirm: z.literal(true) })
        .safeParse(input);
      if (!parsed.success) {
        return validationError(parsed.error.issues[0]?.message ?? "Invalid input");
      }

      const result = await executeToolOperation(
        {
          method: "DELETE",
          path: `/v1/cards/${encodeURIComponent(parsed.data.cardId)}`,
        },
        request,
        executor
      );

      if (!result.ok) {
        return result.result;
      }

      const payload = {
        status: "deleted",
        cardId: parsed.data.cardId,
      };

      return successResult(payload, `Deleted card ${parsed.data.cardId}`);
    }
  ),
});

export const callTeakV1Tool = async (
  name: string,
  input: unknown,
  request: Request,
  executor: PublicApiToolExecutor
): Promise<McpToolResult> => {
  const handlers = toolHandlers(executor);
  const handler = handlers[name as keyof typeof handlers];
  if (!handler) {
    return errorResult(404, {
      code: "NOT_FOUND",
      error: `Unknown tool: ${name}`,
    });
  }

  return handler(input, request);
};
