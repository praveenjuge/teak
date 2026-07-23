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
const cardSortSchema = z.enum(["newest", "oldest"]);
const cardTypeSchema = z.enum([
  "text",
  "link",
  "image",
  "video",
  "audio",
  "document",
  "palette",
  "quote",
]);

const listCardsInputSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  cursor: nonEmptyString.optional(),
  type: cardTypeSchema.optional(),
  favorited: z.boolean().optional(),
  tag: nonEmptyString.optional(),
  sort: cardSortSchema.optional(),
  createdAfter: z.number().optional(),
  createdBefore: z.number().optional(),
});

const getCardChangesInputSchema = z.object({
  since: z.number(),
  cursor: nonEmptyString.optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const createUploadInputSchema = z.object({
  fileName: nonEmptyString,
  mimeType: nonEmptyString,
  fileSize: z.number().positive(),
});

const bulkCardsInputSchema = z
  .object({
    operation: z.enum(["create", "update", "favorite", "delete"]),
    items: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
    confirm: z.literal(true).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.operation === "delete" && value.confirm !== true) {
      ctx.addIssue({
        code: "custom",
        message: "confirm must be true for delete batches",
        path: ["confirm"],
      });
    }
  });

const chatgptSearchInputSchema = z.object({
  query: nonEmptyString,
});

const chatgptFetchInputSchema = z.object({
  id: nonEmptyString,
});

const createCardInputSchema = z
  .object({
    cardType: cardTypeSchema.optional(),
    content: z.string().optional(),
    fileKey: nonEmptyString.optional(),
    fileName: nonEmptyString.optional(),
    fileSize: z.number().positive().optional(),
    mimeType: nonEmptyString.optional(),
    notes: z.string().or(z.null()).optional(),
    source: nonEmptyString.optional(),
    tags: z.array(z.string()).optional(),
    url: nonEmptyString.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.fileKey) {
      if (!value.fileName) {
        ctx.addIssue({
          code: "custom",
          message: "fileName is required with fileKey",
          path: ["fileName"],
        });
      }
      if (!value.mimeType) {
        ctx.addIssue({
          code: "custom",
          message: "mimeType is required with fileKey",
          path: ["mimeType"],
        });
      }
      return;
    }

    if (
      (value.content === undefined && !value.url) ||
      (value.cardType === undefined && !value.url && !value.content?.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        message: "content, url, or fileKey is required",
        path: ["content"],
      });
    }
  });
const cardIdInputSchema = z.object({ cardId: nonEmptyString });
const deleteCardInputSchema = z.object({
  cardId: nonEmptyString,
  confirm: z.literal(true),
});
const favoriteInputSchema = z.object({
  cardId: nonEmptyString,
  isFavorited: z.boolean(),
});

const updateCardInputSchema = z
  .object({
    cardId: nonEmptyString,
    content: z.string().optional(),
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

const queryParams = (
  query: Record<string, QueryValue>
): Record<string, QueryValue> =>
  Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, QueryValue] => {
      const value = entry[1];
      return value !== undefined;
    })
  );

export const TEAK_V1_TOOLS = [
  {
    name: "teak_v1_list_cards",
    description: "List cards with cursor pagination and optional filters.",
    inputSchema: inputSchema({
      limit: { type: "integer", minimum: 1, maximum: 100 },
      cursor: { type: "string", minLength: 1 },
      type: { enum: cardTypeSchema.options },
      favorited: { type: "boolean" },
      tag: { type: "string", minLength: 1 },
      sort: { enum: cardSortSchema.options },
      createdAfter: { type: "number" },
      createdBefore: { type: "number" },
    }),
  },
  {
    name: "teak_v1_get_card",
    description: "Get a card by ID.",
    inputSchema: inputSchema({ cardId: { type: "string", minLength: 1 } }, [
      "cardId",
    ]),
  },
  {
    name: "teak_v1_create_card",
    description:
      "Create a card from text, a URL, or a completed file upload. cardType is optional for file uploads and inferred when omitted.",
    inputSchema: inputSchema({
      cardType: { enum: cardTypeSchema.options },
      content: { type: "string", minLength: 1 },
      fileKey: { type: "string", minLength: 1 },
      fileName: { type: "string", minLength: 1 },
      fileSize: { type: "number", minimum: 1 },
      mimeType: { type: "string", minLength: 1 },
      notes: { type: ["string", "null"] },
      source: { type: "string", minLength: 1 },
      tags: { type: "array", items: { type: "string" } },
      url: { type: "string", minLength: 1 },
    }),
  },
  {
    name: "teak_v1_list_tags",
    description: "List tags used by saved cards.",
    inputSchema: inputSchema({}),
  },
  {
    name: "teak_v1_get_card_changes",
    description: "List card changes since a timestamp with cursor pagination.",
    inputSchema: inputSchema(
      {
        since: { type: "number" },
        cursor: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      ["since"]
    ),
  },
  {
    name: "teak_v1_bulk_cards",
    description:
      "Run a bulk card operation for up to 100 items. Delete batches require confirm: true.",
    inputSchema: inputSchema(
      {
        operation: { enum: ["create", "update", "favorite", "delete"] },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "object", additionalProperties: true },
        },
        confirm: { const: true },
      },
      ["operation", "items"]
    ),
  },
  {
    name: "teak_v1_create_upload",
    description:
      "Create a direct upload URL. PUT bytes to uploadUrl, then create a card with the returned fileKey.",
    inputSchema: inputSchema(
      {
        fileName: { type: "string", minLength: 1 },
        mimeType: { type: "string", minLength: 1 },
        fileSize: { type: "number", minimum: 1 },
      },
      ["fileName", "mimeType", "fileSize"]
    ),
  },
  {
    name: "search",
    description: "Search Teak cards for ChatGPT connectors and Deep Research.",
    inputSchema: inputSchema({ query: { type: "string", minLength: 1 } }, [
      "query",
    ]),
  },
  {
    name: "fetch",
    description:
      "Fetch a Teak card by ID for ChatGPT connectors and Deep Research.",
    inputSchema: inputSchema({ id: { type: "string", minLength: 1 } }, ["id"]),
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

const titleFromCard = (card: JsonObject): string => {
  const metadataTitle =
    typeof card.metadataTitle === "string" ? card.metadataTitle.trim() : "";
  const content = typeof card.content === "string" ? card.content.trim() : "";
  const url = typeof card.url === "string" ? card.url.trim() : "";
  return metadataTitle || content || url || String(card.id ?? "Untitled card");
};

const textFromCard = (card: JsonObject): string =>
  [
    titleFromCard(card),
    typeof card.content === "string" ? card.content : undefined,
    typeof card.notes === "string" ? card.notes : undefined,
    typeof card.aiSummary === "string" ? card.aiSummary : undefined,
    typeof card.url === "string" ? card.url : undefined,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n\n");

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

interface ToolConfig {
  operation: (input: any) => PublicApiToolOperation;
  schema: z.ZodTypeAny;
  summary: (payload: JsonObject, input: any) => string;
  transform?: (payload: JsonObject, input: any) => JsonObject;
}

const count = (payload: JsonObject, field = "items"): number =>
  Array.isArray(payload[field]) ? payload[field].length : 0;

const cardPath = (id: string): string => `/v1/cards/${encodeURIComponent(id)}`;
const queryTool = (path: string): ToolConfig => ({
  schema: queryInputSchema,
  operation: (input) => ({
    method: "GET",
    path,
    query: queryParams({ q: input.q, limit: input.limit }),
  }),
  summary: (payload) => `Fetched ${Number(payload.total) || 0} cards`,
});

const toolConfigs: Record<string, ToolConfig> = {
  teak_v1_list_cards: {
    schema: listCardsInputSchema,
    operation: (input) => ({
      method: "GET",
      path: "/v1/cards",
      query: queryParams(input),
    }),
    summary: (payload) => `Fetched ${count(payload)} cards`,
  },
  teak_v1_get_card: {
    schema: cardIdInputSchema,
    operation: (input) => ({ method: "GET", path: cardPath(input.cardId) }),
    summary: (_payload, input) => `Fetched card ${input.cardId}`,
  },
  teak_v1_create_card: {
    schema: createCardInputSchema,
    operation: (input) => ({
      method: "POST",
      path: "/v1/cards",
      body: input,
    }),
    summary: (payload) =>
      `Card ${typeof payload.status === "string" ? payload.status : "created"}`,
  },
  teak_v1_search_cards: queryTool("/v1/cards/search"),
  teak_v1_list_favorite_cards: {
    ...queryTool("/v1/cards/favorites"),
    summary: (payload) =>
      `Fetched ${Number(payload.total) || 0} favorite cards`,
  },
  teak_v1_update_card: {
    schema: updateCardInputSchema,
    operation: ({ cardId, ...body }) => ({
      method: "PATCH",
      path: cardPath(cardId),
      body: Object.fromEntries(
        Object.entries(body).filter(([, value]) => value !== undefined)
      ),
    }),
    summary: () => "Card updated",
  },
  teak_v1_set_card_favorite: {
    schema: favoriteInputSchema,
    operation: (input) => ({
      method: "PATCH",
      path: `${cardPath(input.cardId)}/favorite`,
      body: { isFavorited: input.isFavorited },
    }),
    summary: (_payload, input) =>
      `Card ${input.isFavorited ? "favorited" : "unfavorited"}`,
  },
  teak_v1_delete_card: {
    schema: deleteCardInputSchema,
    operation: (input) => ({ method: "DELETE", path: cardPath(input.cardId) }),
    transform: (_payload, input) => ({
      status: "deleted",
      cardId: input.cardId,
    }),
    summary: (_payload, input) => `Deleted card ${input.cardId}`,
  },
  teak_v1_list_tags: {
    schema: z.object({}),
    operation: () => ({ method: "GET", path: "/v1/tags" }),
    summary: (payload) => `Fetched ${count(payload)} tags`,
  },
  teak_v1_get_card_changes: {
    schema: getCardChangesInputSchema,
    operation: (input) => ({
      method: "GET",
      path: "/v1/cards/changes",
      query: queryParams(input),
    }),
    summary: (payload) =>
      `Fetched ${count(payload)} changed cards and ${count(payload, "deletedIds")} deleted IDs`,
  },
  teak_v1_bulk_cards: {
    schema: bulkCardsInputSchema,
    operation: (input) => ({
      method: "POST",
      path: "/v1/cards/bulk",
      body: { operation: input.operation, items: input.items },
    }),
    summary: (_payload, input) => `Bulk ${input.operation} complete`,
  },
  teak_v1_create_upload: {
    schema: createUploadInputSchema,
    operation: (input) => ({
      method: "POST",
      path: "/v1/uploads",
      body: input,
    }),
    summary: () =>
      "Upload URL created. PUT bytes to uploadUrl, then create a card with fileKey.",
  },
  search: {
    schema: chatgptSearchInputSchema,
    operation: (input) => ({
      method: "GET",
      path: "/v1/cards/search",
      query: { q: input.query, limit: 10 },
    }),
    transform: (payload) => ({
      results: (Array.isArray(payload.items) ? payload.items : []).map(
        (card: JsonObject) => ({
          id: String(card.id ?? ""),
          title: titleFromCard(card),
          url:
            typeof card.appUrl === "string"
              ? card.appUrl
              : "https://app.teakvault.com",
        })
      ),
    }),
    summary: (payload) => `Found ${count(payload, "results")} cards`,
  },
  fetch: {
    schema: chatgptFetchInputSchema,
    operation: (input) => ({ method: "GET", path: cardPath(input.id) }),
    transform: (payload, input) => ({
      id: String(payload.id ?? input.id),
      title: titleFromCard(payload),
      text: textFromCard(payload),
      url:
        typeof payload.appUrl === "string"
          ? payload.appUrl
          : "https://app.teakvault.com",
      metadata: payload,
    }),
    summary: (payload) => `Fetched card ${payload.id}`,
  },
};

const buildToolHandler = (name: string, executor: PublicApiToolExecutor) =>
  instrumentToolHandler(name, async (input: unknown, request) => {
    const config = toolConfigs[name];
    const parsed = config.schema.safeParse(input);
    if (!parsed.success) {
      return validationError(
        parsed.error.issues[0]?.message ?? "Invalid input"
      );
    }
    const result = await executeToolOperation(
      config.operation(parsed.data),
      request,
      executor
    );
    if (!result.ok) {
      return result.result;
    }
    const payload =
      config.transform?.(result.payload, parsed.data) ?? result.payload;
    return successResult(payload, config.summary(payload, parsed.data));
  });

const toolHandlers = (executor: PublicApiToolExecutor) =>
  Object.fromEntries(
    Object.keys(toolConfigs).map((name) => [
      name,
      buildToolHandler(name, executor),
    ])
  ) as Record<string, ToolHandler<unknown>>;

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

  return await handler(input, request);
};
