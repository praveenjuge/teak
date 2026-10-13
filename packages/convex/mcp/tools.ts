import { z } from "zod";
import { COLOR_HUE_BUCKETS, VISUAL_STYLE_TAXONOMY } from "../shared/constants";
import {
  FOLDER_COLORS,
  MAX_FOLDER_CARD_IDS,
  MAX_FOLDER_NAME_LENGTH,
} from "../shared/folders";
import { MAX_TAG_NAME_LENGTH } from "../shared/tags";
import { captureBackendEvent } from "../telemetry/posthog";

type JsonObject = Record<string, unknown>;
type QueryValue = boolean | number | string | readonly string[] | undefined;

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

const includeSchema = z.enum(["content", "metadata", "processing"]);
const MAX_VISUAL_FILTERS = 24;

// Filters shared by the list and search tools, mirroring GET /v1/cards.
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
  sort: cardSortSchema.optional(),
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
const createFolderInputSchema = z.object({
  name: folderNameSchema,
  color: folderColorSchema.optional(),
});
const updateFolderInputSchema = z
  .object({
    folderId: nonEmptyString,
    name: folderNameSchema.optional(),
    color: folderColorSchema.or(z.null()).optional(),
  })
  .refine((value) => value.name !== undefined || value.color !== undefined, {
    message: "Provide name or color",
    path: ["name"],
  });
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

const stringList = (values: readonly string[], maxItems?: number) => ({
  type: "array",
  items: { enum: values },
  ...(maxItems ? { maxItems } : {}),
});
const cardFilterProperties = {
  q: { type: "string", description: "Full-text search query" },
  limit: { type: "integer", minimum: 1, maximum: 100 },
  cursor: {
    type: "string",
    minLength: 1,
    description: "pageInfo.nextCursor from the previous page",
  },
  type: {
    description: "One card type, or several to match any of them",
    anyOf: [
      { enum: cardTypeSchema.options },
      { ...stringList(cardTypeSchema.options), minItems: 1 },
    ],
  },
  favorited: { type: "boolean", description: "true lists favorites only" },
  trashed: { type: "boolean", description: "true lists cards in Trash only" },
  archived: {
    enum: ["exclude", "only", "include"],
    description:
      "Archived cards: exclude (default) leaves them out, only lists just them, include lists them too",
  },
  folder: {
    type: "string",
    minLength: 1,
    description: "Only cards in this folder id (see teak_v1_list_folders)",
  },
  tag: { type: "string", minLength: 1, description: "Exact tag" },
  sort: { enum: cardSortSchema.options },
  createdAfter: { type: "number", description: "Unix ms" },
  createdBefore: { type: "number", description: "Unix ms" },
  style: stringList(VISUAL_STYLE_TAXONOMY, MAX_VISUAL_FILTERS),
  hue: stringList(COLOR_HUE_BUCKETS, MAX_VISUAL_FILTERS),
  hex: {
    type: "array",
    items: { type: "string", minLength: 1 },
    maxItems: MAX_VISUAL_FILTERS,
    description: "Exact colors such as #112233",
  },
  include: {
    ...stringList(includeSchema.options),
    description:
      "Extra field sets. Defaults to content and metadata so items are full cards.",
  },
};

// MCP tool annotations let clients decide when to ask before a call.
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const WRITES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const IDEMPOTENT_WRITE = { ...WRITES, idempotentHint: true };
const DESTRUCTIVE = { ...WRITES, destructiveHint: true };

export const TEAK_V1_TOOLS = [
  {
    name: "teak_v1_list_cards",
    description:
      "List full cards with cursor pagination and the same filters as search: type, tag, favorites, Trash, visual style, color hue or hex, and dates.",
    annotations: { title: "List cards", ...READ_ONLY },
    inputSchema: inputSchema(cardFilterProperties),
  },
  {
    name: "teak_v1_get_card",
    description:
      "Get a card by ID, including AI summary, tags, transcript and processing status.",
    annotations: { title: "Get card", ...READ_ONLY },
    inputSchema: inputSchema({ cardId: { type: "string", minLength: 1 } }, [
      "cardId",
    ]),
  },
  {
    name: "teak_v1_get_me",
    description:
      "Get the signed-in account: email, plan, card count and the free plan's card limit.",
    annotations: { title: "Get account", ...READ_ONLY },
    inputSchema: inputSchema({}),
  },
  {
    name: "teak_v1_check_duplicate_url",
    description:
      "Check whether a URL is already saved. Returns { cardId } or { cardId: null }; use it before saving a link.",
    annotations: { title: "Check for a saved URL", ...READ_ONLY },
    inputSchema: inputSchema({ url: { type: "string", minLength: 1 } }, [
      "url",
    ]),
  },
  {
    name: "teak_v1_restore_card",
    description: "Restore a card from Trash.",
    annotations: { title: "Restore card", ...IDEMPOTENT_WRITE },
    inputSchema: inputSchema({ cardId: { type: "string", minLength: 1 } }, [
      "cardId",
    ]),
  },
  {
    name: "teak_v1_refresh_card",
    description:
      "Refresh a card's details: clears its summary, tags and transcript and generates them again, along with its link preview. Runs in the background; poll teak_v1_get_card for processingStatus. Limited to once per card per minute.",
    annotations: { title: "Refresh details", ...WRITES },
    inputSchema: inputSchema({ cardId: { type: "string", minLength: 1 } }, [
      "cardId",
    ]),
  },
  {
    name: "teak_v1_create_card",
    description:
      "Create a card from text, a URL, or a completed file upload. cardType is optional and inferred when omitted; Teak detects links, quotes and palettes. Pass idempotencyKey to make retries safe.",
    annotations: { title: "Create card", ...WRITES },
    inputSchema: inputSchema({
      cardType: { enum: cardTypeSchema.options },
      content: { type: "string" },
      idempotencyKey: { type: "string", minLength: 1 },
      fileEtag: { type: "string", minLength: 1 },
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
    annotations: { title: "List tags", ...READ_ONLY },
    inputSchema: inputSchema({}),
  },
  {
    name: "teak_v1_rename_tag",
    description:
      "Rename a tag on every card (user and AI tags, including Trash and Archive), matching it ignoring case. Runs in the background: poll teak_v1_get_tag_operation. Renaming onto an existing tag fails; merge instead.",
    annotations: { title: "Rename tag", ...WRITES },
    inputSchema: inputSchema(
      {
        from: { type: "string", minLength: 1, maxLength: MAX_TAG_NAME_LENGTH },
        to: { type: "string", minLength: 1, maxLength: MAX_TAG_NAME_LENGTH },
      },
      ["from", "to"]
    ),
  },
  {
    name: "teak_v1_merge_tags",
    description:
      "Replace one tag with another on every card; a card with both keeps one. Runs in the background: poll teak_v1_get_tag_operation.",
    annotations: { title: "Merge tags", ...WRITES },
    inputSchema: inputSchema(
      {
        from: { type: "string", minLength: 1, maxLength: MAX_TAG_NAME_LENGTH },
        into: { type: "string", minLength: 1, maxLength: MAX_TAG_NAME_LENGTH },
      },
      ["from", "into"]
    ),
  },
  {
    name: "teak_v1_delete_tag",
    description:
      "Remove a tag from every card. The cards are kept. Runs in the background: poll teak_v1_get_tag_operation. `confirm` must be true.",
    annotations: { title: "Delete tag", ...DESTRUCTIVE },
    inputSchema: inputSchema(
      {
        tag: { type: "string", minLength: 1, maxLength: MAX_TAG_NAME_LENGTH },
        confirm: { const: true },
      },
      ["tag", "confirm"]
    ),
  },
  {
    name: "teak_v1_get_tag_operation",
    description:
      "Get the progress of a tag rename, merge or delete: status, cards changed and total.",
    annotations: { title: "Get tag operation", ...READ_ONLY },
    inputSchema: inputSchema(
      { operationId: { type: "string", minLength: 1 } },
      ["operationId"]
    ),
  },
  {
    name: "teak_v1_get_card_changes",
    description: "List card changes since a timestamp with cursor pagination.",
    annotations: { title: "List card changes", ...READ_ONLY },
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
      "Run a bulk card operation for up to 100 items. Items for favorite take { cardId, isFavorited }; delete, restore, archive and unarchive take { cardId }; addTags and removeTags take { cardId, tags }. Delete batches move cards to Trash and require confirm: true. failedIds lists the cards to retry.",
    annotations: { title: "Bulk card operation", ...DESTRUCTIVE },
    inputSchema: inputSchema(
      {
        operation: {
          enum: [
            "create",
            "update",
            "favorite",
            "delete",
            "archive",
            "unarchive",
            "addTags",
            "removeTags",
            "restore",
          ],
        },
        idempotencyKey: { type: "string", minLength: 1 },
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
    annotations: { title: "Create upload", ...WRITES },
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
    annotations: { title: "Search", ...READ_ONLY },
    inputSchema: inputSchema({ query: { type: "string", minLength: 1 } }, [
      "query",
    ]),
  },
  {
    name: "fetch",
    description:
      "Fetch a Teak card by ID for ChatGPT connectors and Deep Research.",
    annotations: { title: "Fetch", ...READ_ONLY },
    inputSchema: inputSchema({ id: { type: "string", minLength: 1 } }, ["id"]),
  },
  {
    name: "teak_v1_search_cards",
    description:
      "Search cards by text with the same filters as list_cards. Returns { items, total, pageInfo }; pass pageInfo.nextCursor as cursor for more.",
    annotations: { title: "Search cards", ...READ_ONLY },
    inputSchema: inputSchema(cardFilterProperties),
  },
  {
    name: "teak_v1_list_favorite_cards",
    description:
      "List favorited cards, optionally filtered by text and the list_cards filters.",
    annotations: { title: "List favorites", ...READ_ONLY },
    inputSchema: inputSchema(cardFilterProperties),
  },
  {
    name: "teak_v1_update_card",
    description:
      "Update an existing card. tags replaces the card's own tags; removeAiTags drops tags Teak added.",
    annotations: { title: "Update card", ...IDEMPOTENT_WRITE },
    inputSchema: inputSchema(
      {
        cardId: { type: "string", minLength: 1 },
        content: { type: "string", minLength: 1 },
        url: { type: "string", minLength: 1 },
        notes: { type: ["string", "null"] },
        tags: { type: "array", items: { type: "string" } },
        metadataTitle: {
          type: ["string", "null"],
          description: "Card title; null or blank clears it",
        },
        removeAiTags: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
      },
      ["cardId"]
    ),
  },
  {
    name: "teak_v1_set_card_favorite",
    description: "Set a card's favorite state.",
    annotations: { title: "Set favorite", ...IDEMPOTENT_WRITE },
    inputSchema: inputSchema(
      {
        cardId: { type: "string", minLength: 1 },
        isFavorited: { type: "boolean" },
      },
      ["cardId", "isFavorited"]
    ),
  },
  {
    name: "teak_v1_set_card_archived",
    description:
      "Archive a card (hide it from the library without deleting it) or return it to the library. List archived cards with archived: only.",
    annotations: { title: "Set archived", ...IDEMPOTENT_WRITE },
    inputSchema: inputSchema(
      {
        cardId: { type: "string", minLength: 1 },
        isArchived: { type: "boolean" },
      },
      ["cardId", "isArchived"]
    ),
  },
  {
    name: "teak_v1_list_folders",
    description:
      "List folders by name with their ids and card counts. List a folder's cards with teak_v1_list_cards and `folder`.",
    annotations: { title: "List folders", ...READ_ONLY },
    inputSchema: inputSchema({}),
  },
  {
    name: "teak_v1_create_folder",
    description:
      "Create a folder. Names are unique per account, ignoring case.",
    annotations: { title: "Create folder", ...WRITES },
    inputSchema: inputSchema(
      {
        name: {
          type: "string",
          minLength: 1,
          maxLength: MAX_FOLDER_NAME_LENGTH,
        },
        color: { enum: FOLDER_COLORS },
      },
      ["name"]
    ),
  },
  {
    name: "teak_v1_update_folder",
    description: "Rename a folder or change its color (null clears it).",
    annotations: { title: "Update folder", ...IDEMPOTENT_WRITE },
    inputSchema: inputSchema(
      {
        folderId: { type: "string", minLength: 1 },
        name: {
          type: "string",
          minLength: 1,
          maxLength: MAX_FOLDER_NAME_LENGTH,
        },
        color: { enum: [...FOLDER_COLORS, null] },
      },
      ["folderId"]
    ),
  },
  {
    name: "teak_v1_delete_folder",
    description: "Delete a folder. Its cards are kept. `confirm` must be true.",
    annotations: { title: "Delete folder", ...DESTRUCTIVE },
    inputSchema: inputSchema(
      {
        folderId: { type: "string", minLength: 1 },
        confirm: { const: true },
      },
      ["folderId", "confirm"]
    ),
  },
  {
    name: "teak_v1_add_cards_to_folder",
    description: `Add up to ${MAX_FOLDER_CARD_IDS} cards to a folder. Cards already in it are left as they are.`,
    annotations: { title: "Add cards to folder", ...IDEMPOTENT_WRITE },
    inputSchema: inputSchema(
      {
        folderId: { type: "string", minLength: 1 },
        cardIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: MAX_FOLDER_CARD_IDS,
        },
      },
      ["folderId", "cardIds"]
    ),
  },
  {
    name: "teak_v1_remove_cards_from_folder",
    description: `Remove up to ${MAX_FOLDER_CARD_IDS} cards from a folder. The cards are kept.`,
    annotations: { title: "Remove cards from folder", ...IDEMPOTENT_WRITE },
    inputSchema: inputSchema(
      {
        folderId: { type: "string", minLength: 1 },
        cardIds: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: MAX_FOLDER_CARD_IDS,
        },
      },
      ["folderId", "cardIds"]
    ),
  },
  {
    name: "teak_v1_delete_card",
    description:
      "Move a card to Trash, where teak_v1_restore_card can bring it back. `confirm` must be true.",
    annotations: { title: "Move card to Trash", ...DESTRUCTIVE },
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
        // A partial bulk failure has no HTTP status of its own.
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
  /** Marks a successful HTTP response as a tool error, e.g. failed bulk items. */
  isError?: (payload: JsonObject) => boolean;
  operation: (input: any) => PublicApiToolOperation;
  schema: z.ZodTypeAny;
  summary: (payload: JsonObject, input: any) => string;
  transform?: (payload: JsonObject, input: any) => JsonObject;
}

const count = (payload: JsonObject, field = "items"): number =>
  Array.isArray(payload[field]) ? payload[field].length : 0;

/** "1 card", "3 cards". */
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
// Search-style tools query the card list endpoint. The list returns full cards
// only with content+metadata included, and the transform keeps the stable
// {items,total} tool payload unchanged.
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
