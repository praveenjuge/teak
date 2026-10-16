import { EDGE_RATE_LIMIT_HEADER } from "@teak/files-protocol";
import { z } from "zod";
import { COLOR_HUE_BUCKETS, VISUAL_STYLE_TAXONOMY } from "../shared/constants";
import {
  FOLDER_COLORS,
  MAX_FOLDER_CARD_IDS,
  MAX_FOLDER_NAME_LENGTH,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "../shared/folders";
import { SEARCH_MODES } from "../shared/search/semantic";
import { MAX_TAG_NAME_LENGTH } from "../shared/tags";
import {
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_MIME_TYPES,
} from "../shared/thumbnails";
import { captureBackendEvent } from "../telemetry/posthog";
import {
  MAX_VISUAL_FILTERS,
  MCP_CARD_INCLUDES,
  MCP_CARD_SORTS,
  MCP_CARD_TYPES,
} from "./protocol";

export { TEAK_V1_TOOLS } from "./protocol";

type JsonObject = Record<string, unknown>;
type QueryValue = boolean | number | string | readonly string[] | undefined;

export interface PublicApiToolOperation {
  body?: unknown;
  headers?: HeadersInit;
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
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

const nonEmptyString = z.string().trim().min(1);
const cardSortSchema = z.enum(MCP_CARD_SORTS);
const cardTypeSchema = z.enum(MCP_CARD_TYPES);
const includeSchema = z.enum(MCP_CARD_INCLUDES);

const cardFiltersShape = {
  q: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
  cursor: nonEmptyString.optional(),
  type: z.union([cardTypeSchema, z.array(cardTypeSchema).min(1)]).optional(),
  favorited: z.boolean().optional(),
  trashed: z.boolean().optional(),
  archived: z.enum(["exclude", "only", "include"]).optional(),
  folder: nonEmptyString.optional(),
  tag: nonEmptyString.optional(),
  mode: z.enum(SEARCH_MODES).optional(),
  similarTo: nonEmptyString.optional(),
  sort: cardSortSchema.optional(),
  shuffleSeed: z.number().int().min(0).max(2_147_483_647).optional(),
  createdAfter: z.number().optional(),
  createdBefore: z.number().optional(),
  style: z
    .array(z.enum(VISUAL_STYLE_TAXONOMY))
    .max(MAX_VISUAL_FILTERS)
    .optional(),
  hue: z.array(z.enum(COLOR_HUE_BUCKETS)).max(MAX_VISUAL_FILTERS).optional(),
  hex: z.array(nonEmptyString).max(MAX_VISUAL_FILTERS).optional(),
  include: z.array(includeSchema).optional(),
};
const listCardsInputSchema = z.object(cardFiltersShape);
const findSimilarInputSchema = z.object({
  cardId: nonEmptyString,
  limit: cardFiltersShape.limit,
  cursor: cardFiltersShape.cursor,
  type: cardFiltersShape.type,
  sort: cardFiltersShape.sort,
  shuffleSeed: cardFiltersShape.shuffleSeed,
  include: cardFiltersShape.include,
});
const queryInputSchema = listCardsInputSchema;
const duplicateInputSchema = z.object({ url: nonEmptyString });

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
    operation: z.enum([
      "create",
      "update",
      "favorite",
      "delete",
      "archive",
      "unarchive",
      "addTags",
      "removeTags",
      "restore",
    ]),
    items: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
    confirm: z.literal(true).optional(),
    idempotencyKey: nonEmptyString.optional(),
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
    fileEtag: nonEmptyString.optional(),
    fileKey: nonEmptyString.optional(),
    fileName: nonEmptyString.optional(),
    fileSize: z.number().positive().optional(),
    mimeType: nonEmptyString.optional(),
    notes: z.string().or(z.null()).optional(),
    source: nonEmptyString.optional(),
    tags: z.array(z.string()).optional(),
    url: nonEmptyString.optional(),
    idempotencyKey: nonEmptyString.optional(),
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
      (value.cardType !== "text" && !value.url && !value.content?.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        message: "content, url, or fileKey is required",
        path: ["content"],
      });
    }
  });
const cardIdInputSchema = z.object({ cardId: nonEmptyString });
const thumbnailUploadInputSchema = z.object({
  cardId: nonEmptyString,
  mimeType: z.enum(THUMBNAIL_MIME_TYPES),
  fileSize: z.number().int().positive().max(THUMBNAIL_MAX_BYTES),
});
const setThumbnailInputSchema = z.object({
  cardId: nonEmptyString,
  fileKey: nonEmptyString,
});
const deleteCardInputSchema = z.object({
  cardId: nonEmptyString,
  confirm: z.literal(true),
});
const favoriteInputSchema = z.object({
  cardId: nonEmptyString,
  isFavorited: z.boolean(),
});
const archivedInputSchema = z.object({
  cardId: nonEmptyString,
  isArchived: z.boolean(),
});
const folderNameSchema = nonEmptyString.max(MAX_FOLDER_NAME_LENGTH);
const folderColorSchema = z.enum(FOLDER_COLORS);
const smartFolderQuerySchema = nonEmptyString.max(
  MAX_SMART_FOLDER_QUERY_LENGTH
);
const createFolderInputSchema = z
  .object({
    name: folderNameSchema,
    color: folderColorSchema.optional(),
    kind: z.enum(["manual", "smart"]).optional(),
    query: smartFolderQuerySchema.optional(),
  })
  .refine((value) => (value.kind === "smart") === (value.query !== undefined), {
    message: 'A smart folder needs `query`, and `query` needs kind "smart"',
    path: ["query"],
  });
const updateFolderInputSchema = z
  .object({
    folderId: nonEmptyString,
    name: folderNameSchema.optional(),
    color: folderColorSchema.or(z.null()).optional(),
    query: smartFolderQuerySchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.color !== undefined ||
      value.query !== undefined,
    {
      message: "Provide name, color or query",
      path: ["name"],
    }
  );
const folderIdInputSchema = z.object({ folderId: nonEmptyString });
const deleteFolderInputSchema = z.object({
  folderId: nonEmptyString,
  confirm: z.literal(true),
});
const folderCardsInputSchema = z.object({
  folderId: nonEmptyString,
  cardIds: z.array(nonEmptyString).min(1).max(MAX_FOLDER_CARD_IDS),
});

const tagNameSchema = nonEmptyString.max(MAX_TAG_NAME_LENGTH);
const renameTagInputSchema = z.object({
  from: tagNameSchema,
  to: tagNameSchema,
});
const mergeTagsInputSchema = z.object({
  from: tagNameSchema,
  into: tagNameSchema,
});
const deleteTagInputSchema = z.object({
  tag: tagNameSchema,
  confirm: z.literal(true),
});
const tagOperationInputSchema = z.object({ operationId: nonEmptyString });

const updateCardInputSchema = z
  .object({
    cardId: nonEmptyString,
    content: z.string().optional(),
    url: nonEmptyString.optional(),
    notes: z.string().or(z.null()).optional(),
    tags: z.array(z.string()).optional(),
    metadataTitle: z.string().or(z.null()).optional(),
    removeAiTags: z.array(nonEmptyString).min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.content === undefined &&
      value.url === undefined &&
      value.notes === undefined &&
      value.tags === undefined &&
      value.metadataTitle === undefined &&
      value.removeAiTags === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "At least one field must be provided: content, url, notes, tags, metadataTitle, removeAiTags",
        path: ["content"],
      });
    }
  });

const createTextContent = (text: string): McpToolResult["content"] => [
  { type: "text", text },
];

const queryParams = (
  query: Record<string, QueryValue>
): Record<string, QueryValue> =>
  Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, QueryValue] => {
      const value = entry[1];
      return value !== undefined;
    })
  );

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
          typeof structured?.status === "number"
            ? structured.status
            : undefined;
        outcome = status === 401 ? "unauthorized" : "error";
      }
      return result;
    } finally {
      await captureBackendEvent("mcp_tool_called", undefined, {
        duration_ms: Date.now() - start,
        outcome,
        status,
        tool: toolName,
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

  const edgeRateLimit = request.headers.get(EDGE_RATE_LIMIT_HEADER);
  const response = await executor({
    ...operation,
    headers: {
      ...(operation.headers ?? {}),
      Authorization: authorization,
      ...(edgeRateLimit ? { [EDGE_RATE_LIMIT_HEADER]: edgeRateLimit } : {}),
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
  isError?: (payload: JsonObject) => boolean;
  operation: (input: any) => PublicApiToolOperation;
  schema: z.ZodTypeAny;
  summary: (payload: JsonObject, input: any) => string;
  transform?: (payload: JsonObject, input: any) => JsonObject;
}

const count = (payload: JsonObject, field = "items"): number =>
  Array.isArray(payload[field]) ? payload[field].length : 0;

const countLabel = (value: number, noun: string) =>
  `${value} ${noun}${value === 1 ? "" : "s"}`;

const bulkSummary = (payload: JsonObject) => {
  const summary = toObjectPayload(payload.summary);
  return {
    failed: Number(summary.failed) || 0,
    succeeded: Number(summary.succeeded) || 0,
    total: Number(summary.total) || 0,
  };
};

const cardPath = (id: string): string => `/v1/cards/${encodeURIComponent(id)}`;
const folderPath = (id: string): string =>
  `/v1/folders/${encodeURIComponent(id)}`;
const FULL_CARD_INCLUDE = "content,metadata";
const pageToCardResults = (payload: JsonObject): JsonObject => ({
  items: Array.isArray(payload.items) ? payload.items : [],
  total: count(payload),
});
const cardsQuery = ({ include, ...filters }: JsonObject) =>
  queryParams({
    ...(filters as Record<string, QueryValue>),
    include: Array.isArray(include) ? include.join(",") : FULL_CARD_INCLUDE,
  });
const queryTool = (extraQuery: Record<string, QueryValue>): ToolConfig => ({
  schema: queryInputSchema,
  operation: (input) => ({
    method: "GET",
    path: "/v1/cards",
    query: queryParams({ ...cardsQuery(input), ...extraQuery }),
  }),
  transform: (payload) => ({
    ...pageToCardResults(payload),
    pageInfo: payload.pageInfo ?? { hasMore: false, nextCursor: null },
    ...(payload.searchMode ? { searchMode: payload.searchMode } : {}),
  }),
  summary: (payload) => `Fetched ${Number(payload.total) || 0} cards`,
});
const idempotencyHeaders = (key?: string): HeadersInit | undefined =>
  key ? { "Idempotency-Key": key } : undefined;

const toolConfigs: Record<string, ToolConfig> = {
  teak_v1_list_cards: {
    schema: listCardsInputSchema,
    operation: (input) => ({
      method: "GET",
      path: "/v1/cards",
      query: cardsQuery(input),
    }),
    summary: (payload) => `Fetched ${count(payload)} cards`,
  },
  teak_v1_get_card: {
    schema: cardIdInputSchema,
    operation: (input) => ({ method: "GET", path: cardPath(input.cardId) }),
    summary: (_payload, input) => `Fetched card ${input.cardId}`,
  },
  teak_v1_get_card_content: {
    schema: cardIdInputSchema,
    operation: (input) => ({
      method: "GET",
      path: `${cardPath(input.cardId)}/content`,
    }),
    summary: (payload, input) =>
      `Read ${Number(payload.charCount) || 0} characters of ${typeof payload.kind === "string" ? payload.kind : "text"} from card ${input.cardId}${payload.truncated ? " (truncated)" : ""}`,
  },
  teak_v1_get_me: {
    schema: z.object({}),
    operation: () => ({ method: "GET", path: "/v1/me" }),
    transform: (payload) => toObjectPayload(payload.data),
    summary: (payload) =>
      `Signed in on the ${payload.plan === "pro" ? "Pro" : "Free"} plan with ${Number(payload.cardCount) || 0} cards`,
  },
  teak_v1_check_duplicate_url: {
    schema: duplicateInputSchema,
    operation: (input) => ({
      method: "GET",
      path: "/v1/cards/duplicate",
      query: { url: input.url },
    }),
    summary: (payload) =>
      payload.cardId ? `Already saved as ${payload.cardId}` : "Not saved yet",
  },
  teak_v1_restore_card: {
    schema: cardIdInputSchema,
    operation: (input) => ({
      method: "POST",
      path: `${cardPath(input.cardId)}/restore`,
    }),
    transform: (_payload, input) => ({
      status: "restored",
      cardId: input.cardId,
    }),
    summary: (_payload, input) => `Restored card ${input.cardId}`,
  },
  teak_v1_refresh_card: {
    schema: cardIdInputSchema,
    operation: (input) => ({
      method: "POST",
      path: `${cardPath(input.cardId)}/refresh`,
    }),
    summary: (_payload, input) => `Refreshing card ${input.cardId}`,
  },
  teak_v1_create_card: {
    schema: createCardInputSchema,
    operation: ({ idempotencyKey, ...body }) => ({
      method: "POST",
      path: "/v1/cards",
      body,
      headers: idempotencyHeaders(idempotencyKey),
    }),
    summary: (payload) =>
      `Card ${typeof payload.status === "string" ? payload.status : "created"}`,
  },
  teak_v1_search_cards: queryTool({}),
  teak_v1_find_similar_cards: {
    schema: findSimilarInputSchema,
    operation: ({ cardId, ...input }) => ({
      method: "GET",
      path: "/v1/cards",
      query: queryParams({
        ...cardsQuery(input),
        similarTo: cardId as QueryValue,
      }),
    }),
    transform: (payload) => ({
      ...pageToCardResults(payload),
      pageInfo: payload.pageInfo ?? { hasMore: false, nextCursor: null },
      ...(payload.similarity ? { similarity: payload.similarity } : {}),
    }),
    summary: (payload) => `Found ${Number(payload.total) || 0} similar cards`,
  },
  teak_v1_list_favorite_cards: {
    ...queryTool({ favorited: true }),
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
  teak_v1_create_thumbnail_upload: {
    schema: thumbnailUploadInputSchema,
    operation: ({ cardId, ...body }) => ({
      method: "POST",
      path: `${cardPath(cardId)}/thumbnail/upload`,
      body,
    }),
    summary: () =>
      "Upload URL created. PUT the image to uploadUrl, then call teak_v1_set_card_thumbnail with fileKey.",
  },
  teak_v1_set_card_thumbnail: {
    schema: setThumbnailInputSchema,
    operation: (input) => ({
      method: "PUT",
      path: `${cardPath(input.cardId)}/thumbnail`,
      body: { fileKey: input.fileKey },
    }),
    summary: (_payload, input) => `Replaced the image of card ${input.cardId}`,
  },
  teak_v1_reset_card_thumbnail: {
    schema: cardIdInputSchema,
    operation: (input) => ({
      method: "DELETE",
      path: `${cardPath(input.cardId)}/thumbnail`,
    }),
    summary: (_payload, input) =>
      `Card ${input.cardId} shows its original image`,
  },
  teak_v1_set_card_archived: {
    schema: archivedInputSchema,
    operation: (input) => ({
      method: "PATCH",
      path: cardPath(input.cardId),
      body: { isArchived: input.isArchived },
    }),
    summary: (_payload, input) =>
      `Card ${input.isArchived ? "archived" : "returned to the library"}`,
  },
  teak_v1_delete_card: {
    schema: deleteCardInputSchema,
    operation: (input) => ({ method: "DELETE", path: cardPath(input.cardId) }),
    transform: (_payload, input) => ({
      status: "trashed",
      cardId: input.cardId,
    }),
    summary: (_payload, input) => `Moved card ${input.cardId} to Trash`,
  },
  teak_v1_list_folders: {
    schema: z.object({}),
    operation: () => ({ method: "GET", path: "/v1/folders" }),
    summary: (payload) => `Fetched ${countLabel(count(payload), "folder")}`,
  },
  teak_v1_create_folder: {
    schema: createFolderInputSchema,
    operation: (input) => ({
      method: "POST",
      path: "/v1/folders",
      body: input,
    }),
    summary: (payload) => `Created folder ${String(payload.name ?? "")}`,
  },
  teak_v1_update_folder: {
    schema: updateFolderInputSchema,
    operation: ({ folderId, ...body }) => ({
      method: "PATCH",
      path: folderPath(folderId),
      body,
    }),
    summary: (payload) => `Updated folder ${String(payload.name ?? "")}`,
  },
  teak_v1_get_folder: {
    schema: folderIdInputSchema,
    operation: (input) => ({ method: "GET", path: folderPath(input.folderId) }),
    summary: (payload, input) =>
      `Fetched folder ${typeof payload.name === "string" ? payload.name : input.folderId}`,
  },
  teak_v1_delete_folder: {
    schema: deleteFolderInputSchema,
    operation: (input) => ({
      method: "DELETE",
      path: folderPath(input.folderId),
    }),
    transform: (_payload, input) => ({
      status: "deleted",
      folderId: input.folderId,
    }),
    summary: (_payload, input) => `Deleted folder ${input.folderId}`,
  },
  teak_v1_add_cards_to_folder: {
    schema: folderCardsInputSchema,
    operation: (input) => ({
      method: "POST",
      path: `${folderPath(input.folderId)}/cards`,
      body: { cardIds: input.cardIds },
    }),
    isError: (payload) => count(payload, "failedIds") > 0,
    summary: (payload) =>
      `Added ${countLabel(count(payload, "updatedIds"), "card")}; ${count(payload, "failedIds")} failed`,
  },
  teak_v1_remove_cards_from_folder: {
    schema: folderCardsInputSchema,
    operation: (input) => ({
      method: "DELETE",
      path: `${folderPath(input.folderId)}/cards`,
      body: { cardIds: input.cardIds },
    }),
    isError: (payload) => count(payload, "failedIds") > 0,
    summary: (payload) =>
      `Removed ${countLabel(count(payload, "updatedIds"), "card")}; ${count(payload, "failedIds")} failed`,
  },
  teak_v1_list_tags: {
    schema: z.object({}),
    operation: () => ({ method: "GET", path: "/v1/tags" }),
    summary: (payload) => `Fetched ${count(payload)} tags`,
  },
  teak_v1_rename_tag: {
    schema: renameTagInputSchema,
    operation: (input) => ({
      method: "POST",
      path: "/v1/tags/rename",
      body: { from: input.from, to: input.to },
    }),
    summary: (_payload, input) => `Renaming tag ${input.from} to ${input.to}`,
  },
  teak_v1_merge_tags: {
    schema: mergeTagsInputSchema,
    operation: (input) => ({
      method: "POST",
      path: "/v1/tags/merge",
      body: { from: input.from, into: input.into },
    }),
    summary: (_payload, input) =>
      `Merging tag ${input.from} into ${input.into}`,
  },
  teak_v1_delete_tag: {
    schema: deleteTagInputSchema,
    operation: (input) => ({
      method: "POST",
      path: "/v1/tags/delete",
      body: { tag: input.tag },
    }),
    summary: (_payload, input) => `Deleting tag ${input.tag}`,
  },
  teak_v1_get_tag_operation: {
    schema: tagOperationInputSchema,
    operation: (input) => ({
      method: "GET",
      path: `/v1/tags/operations/${encodeURIComponent(input.operationId)}`,
    }),
    summary: (payload) =>
      `Tag ${String(payload.kind ?? "change")} ${String(payload.status ?? "")}: ${countLabel(Number(payload.changed) || 0, "card")} changed of ${Number(payload.total) || 0}`,
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
      headers: idempotencyHeaders(input.idempotencyKey),
    }),
    isError: (payload) => bulkSummary(payload).failed > 0,
    summary: (payload, input) => {
      const { failed, succeeded, total } = bulkSummary(payload);
      if (failed === 0) {
        return `Bulk ${input.operation} complete: ${succeeded} of ${total} succeeded`;
      }
      const failures = (Array.isArray(payload.results) ? payload.results : [])
        .map(toObjectPayload)
        .filter((item) => item.status === "error")
        .slice(0, 10)
        .map(
          (item) =>
            `item ${String(item.index)}: ${typeof item.code === "string" ? `${item.code}: ` : ""}${String(item.error ?? "failed")}`
        );
      return [
        `Bulk ${input.operation}: ${failed} of ${total} items failed.`,
        ...failures,
      ].join("\n");
    },
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
      path: "/v1/cards",
      query: { q: input.query, limit: 10, include: FULL_CARD_INCLUDE },
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
    const toolResult = successResult(
      payload,
      config.summary(payload, parsed.data)
    );
    return config.isError?.(payload)
      ? { ...toolResult, isError: true }
      : toolResult;
  });

export const isTeakV1Tool = (name: string): boolean =>
  Object.keys(toolConfigs).includes(name);

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
