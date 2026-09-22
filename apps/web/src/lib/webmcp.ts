import { type CardType, cardTypes } from "@teak/convex/shared/constants";

/**
 * Minimal structural view of the WebMCP `ModelContext` API surface Teak uses.
 * The spec is a W3C draft and the DOM lib does not type it yet, so Teak types
 * only the members it touches: https://webmachinelearning.github.io/webmcp/
 */
export interface WebMcpToolInputSchema {
  additionalProperties: false;
  properties: Record<string, unknown>;
  required?: string[];
  type: "object";
}

/**
 * Spec `ToolAnnotations` hints. Agents use them to decide when a tool is safe
 * to call unprompted; every hint defaults to false when omitted.
 */
export interface WebMcpToolAnnotations {
  consequentialHint?: boolean;
  debugging?: boolean;
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface WebMcpToolDefinition {
  annotations?: WebMcpToolAnnotations;
  description: string;
  execute: (
    input: unknown,
    options: { signal: AbortSignal }
  ) => Promise<unknown>;
  inputSchema: WebMcpToolInputSchema;
  name: string;
  title: string;
}

export interface WebMcpModelContext {
  addEventListener?: (type: string, listener: () => void) => void;
  getTools?: () => Promise<{ name: string; description?: string }[]>;
  registerTool: (
    tool: WebMcpToolDefinition,
    options?: { signal?: AbortSignal }
  ) => Promise<void>;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/** Tool lifecycle events Teak observes (spec section 4.4). */
export const WEBMCP_TOOL_EVENT_TYPES = [
  "toolchange",
  "toolactivated",
  "toolcancel",
] as const;

export type WebMcpToolEventType = (typeof WEBMCP_TOOL_EVENT_TYPES)[number];

/**
 * Subscribe to every tool lifecycle event. Contexts without event support
 * (partial implementations, test doubles) get a no-op cleanup function.
 */
export const subscribeWebMcpToolEvents = (
  modelContext: WebMcpModelContext,
  onEvent: (type: WebMcpToolEventType) => void
): (() => void) => {
  const addListener = modelContext.addEventListener?.bind(modelContext);
  const removeListener = modelContext.removeEventListener?.bind(modelContext);
  if (!(addListener && removeListener)) {
    return () => {};
  }
  const entries = WEBMCP_TOOL_EVENT_TYPES.map((type) => {
    const listener = (): void => onEvent(type);
    addListener(type, listener);
    return { listener, type };
  });
  return () => {
    for (const { listener, type } of entries) {
      removeListener(type, listener);
    }
  };
};

/** Tool names are prefixed like the remote MCP tools (`teak_v1_*`). */
export const WEBMCP_SEARCH_TOOL_NAME = "teak_search_cards";
export const WEBMCP_GET_TOOL_NAME = "teak_get_card";
export const WEBMCP_CREATE_TOOL_NAME = "teak_create_card";
export const WEBMCP_TAGS_TOOL_NAME = "teak_update_tags";
export const WEBMCP_FAVORITE_TOOL_NAME = "teak_set_favorite";
export const WEBMCP_RECENT_TOOL_NAME = "teak_recent_cards";

export const WEBMCP_TOOL_NAMES = [
  WEBMCP_SEARCH_TOOL_NAME,
  WEBMCP_GET_TOOL_NAME,
  WEBMCP_CREATE_TOOL_NAME,
  WEBMCP_TAGS_TOOL_NAME,
  WEBMCP_FAVORITE_TOOL_NAME,
  WEBMCP_RECENT_TOOL_NAME,
] as const;

// Tool descriptions are a prompt-injection surface (spec section 6.3.1), so
// they stay static strings and never interpolate user data.
const SEARCH_TOOL_DESCRIPTION =
  "Search the signed-in user's Teak cards by keyword, with optional card-type and favorites filters. Returns matching card summaries.";
const GET_TOOL_DESCRIPTION =
  "Get one Teak card by ID for the signed-in user. Returns the card detail, or null when the ID does not exist.";
const CREATE_TOOL_DESCRIPTION =
  "Create a new Teak card for the signed-in user. Supports text, quote, and link cards with optional notes and tags. Returns the created card ID.";
const TAGS_TOOL_DESCRIPTION =
  "Add or remove tags on one Teak card for the signed-in user. Tags are matched exactly; tags not mentioned are kept. Returns the updated tag list.";
const FAVORITE_TOOL_DESCRIPTION =
  "Set or clear the favorite flag on one Teak card for the signed-in user. Returns the updated flag.";
const RECENT_TOOL_DESCRIPTION =
  "List the signed-in user's most recently created Teak cards, newest first, with an optional card-type filter. Returns matching card summaries.";

/** Card types creatable without a file upload flow. */
export const WEBMCP_CREATE_CARD_TYPES = ["text", "quote", "link"] as const;

export type WebMcpCreateCardType = (typeof WEBMCP_CREATE_CARD_TYPES)[number];

export const WEBMCP_DEFAULT_LIMIT = 20;
export const WEBMCP_MAX_LIMIT = 50;

export const WEBMCP_SEARCH_INPUT_SCHEMA: WebMcpToolInputSchema = {
  type: "object",
  properties: {
    q: {
      type: "string",
      description: "Keyword query. Omit or leave blank to list recent cards.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: WEBMCP_MAX_LIMIT,
      description: "Maximum cards to return. Defaults to 20.",
    },
    type: {
      type: "string",
      enum: [...cardTypes],
      description: "Only return cards of this type.",
    },
    favorited: {
      type: "boolean",
      description: "When true, only return favorited cards.",
    },
  },
  additionalProperties: false,
};

export const WEBMCP_GET_INPUT_SCHEMA: WebMcpToolInputSchema = {
  type: "object",
  properties: {
    cardId: {
      type: "string",
      minLength: 1,
      description: "The Teak card ID.",
    },
  },
  required: ["cardId"],
  additionalProperties: false,
};

export const WEBMCP_CREATE_INPUT_SCHEMA: WebMcpToolInputSchema = {
  type: "object",
  properties: {
    content: {
      type: "string",
      minLength: 1,
      description: "The card content. Required.",
    },
    type: {
      type: "string",
      enum: [...WEBMCP_CREATE_CARD_TYPES],
      description: "The card type. Defaults to text.",
    },
    url: {
      type: "string",
      description: "Source URL, used by link cards.",
    },
    notes: {
      type: "string",
      description: "Private notes attached to the card.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Tags attached to the card.",
    },
  },
  required: ["content"],
  additionalProperties: false,
};

export const WEBMCP_TAGS_INPUT_SCHEMA: WebMcpToolInputSchema = {
  type: "object",
  properties: {
    cardId: {
      type: "string",
      minLength: 1,
      description: "The Teak card ID.",
    },
    add: {
      type: "array",
      items: { type: "string" },
      description: "Tags to add. At least one of add or remove is required.",
    },
    remove: {
      type: "array",
      items: { type: "string" },
      description: "Tags to remove, matched exactly.",
    },
  },
  required: ["cardId"],
  additionalProperties: false,
};

export const WEBMCP_FAVORITE_INPUT_SCHEMA: WebMcpToolInputSchema = {
  type: "object",
  properties: {
    cardId: {
      type: "string",
      minLength: 1,
      description: "The Teak card ID.",
    },
    favorited: {
      type: "boolean",
      description: "True to favorite the card, false to unfavorite it.",
    },
  },
  required: ["cardId", "favorited"],
  additionalProperties: false,
};

export const WEBMCP_RECENT_INPUT_SCHEMA: WebMcpToolInputSchema = {
  type: "object",
  properties: {
    limit: {
      type: "integer",
      minimum: 1,
      maximum: WEBMCP_MAX_LIMIT,
      description: "Maximum cards to return. Defaults to 20.",
    },
    type: {
      type: "string",
      enum: [...cardTypes],
      description: "Only return cards of this type.",
    },
  },
  additionalProperties: false,
};

const EXCERPT_LENGTH = 280;
const DETAIL_CONTENT_LENGTH = 8000;

export interface WebMcpSearchArgs {
  favorited?: boolean;
  limit: number;
  q?: string;
  type?: CardType;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const throwIfAborted = (toolName: string, signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new DOMException(
      `${toolName}: tool execution was cancelled`,
      "AbortError"
    );
  }
};

/**
 * Race a side-effect-free read against cancellation. Writes never race:
 * rejecting after a mutation may already have applied would fake a
 * cancellation and invite a duplicate retry.
 */
const withAbort = <T>(
  toolName: string,
  signal: AbortSignal,
  work: () => Promise<T>
): Promise<T> => {
  throwIfAborted(toolName, signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(
        new DOMException(
          `${toolName}: tool execution was cancelled`,
          "AbortError"
        )
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
};

const isCardType = (value: unknown): value is CardType =>
  typeof value === "string" && (cardTypes as readonly string[]).includes(value);

/** Normalize untrusted tool input. Throws on values that fail closed. */
export const normalizeSearchToolInput = (input: unknown): WebMcpSearchArgs => {
  if (input !== undefined && !isRecord(input)) {
    throw new Error(`${WEBMCP_SEARCH_TOOL_NAME}: input must be an object`);
  }
  const record = input ?? {};
  const { q, limit, type, favorited } = record as Record<string, unknown>;

  if (q !== undefined && typeof q !== "string") {
    throw new Error(`${WEBMCP_SEARCH_TOOL_NAME}: "q" must be a string`);
  }
  if (type !== undefined && !isCardType(type)) {
    throw new Error(
      `${WEBMCP_SEARCH_TOOL_NAME}: "type" must be one of ${cardTypes.join(", ")}`
    );
  }
  if (favorited !== undefined && typeof favorited !== "boolean") {
    throw new Error(
      `${WEBMCP_SEARCH_TOOL_NAME}: "favorited" must be a boolean`
    );
  }
  if (
    limit !== undefined &&
    (typeof limit !== "number" || !Number.isInteger(limit))
  ) {
    throw new Error(`${WEBMCP_SEARCH_TOOL_NAME}: "limit" must be an integer`);
  }

  return {
    ...(typeof q === "string" && q.trim() ? { q: q.trim() } : {}),
    limit: Math.min(
      Math.max(limit ?? WEBMCP_DEFAULT_LIMIT, 1),
      WEBMCP_MAX_LIMIT
    ),
    ...(type === undefined ? {} : { type }),
    ...(favorited === undefined ? {} : { favorited }),
  };
};

export const normalizeGetToolInput = (input: unknown): { cardId: string } => {
  if (!isRecord(input)) {
    throw new Error(`${WEBMCP_GET_TOOL_NAME}: input must be an object`);
  }
  const { cardId } = input;
  if (typeof cardId !== "string" || !cardId.trim()) {
    throw new Error(
      `${WEBMCP_GET_TOOL_NAME}: "cardId" must be a non-empty string`
    );
  }
  return { cardId: cardId.trim() };
};

export interface WebMcpCreateArgs {
  content: string;
  notes?: string;
  tags?: string[];
  type: WebMcpCreateCardType;
  url?: string;
}

const isCreateCardType = (value: unknown): value is WebMcpCreateCardType =>
  typeof value === "string" &&
  (WEBMCP_CREATE_CARD_TYPES as readonly string[]).includes(value);

const normalizeTagList = (
  toolName: string,
  field: string,
  value: unknown
): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    throw new Error(`${toolName}: "${field}" must be an array of strings`);
  }
  const tags = value.map((tag) => tag.trim()).filter(Boolean);
  return tags.length > 0 ? tags : undefined;
};

export const normalizeCreateToolInput = (input: unknown): WebMcpCreateArgs => {
  if (!isRecord(input)) {
    throw new Error(`${WEBMCP_CREATE_TOOL_NAME}: input must be an object`);
  }
  const { content, type, url, notes, tags } = input;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(
      `${WEBMCP_CREATE_TOOL_NAME}: "content" must be a non-empty string`
    );
  }
  if (type !== undefined && !isCreateCardType(type)) {
    throw new Error(
      `${WEBMCP_CREATE_TOOL_NAME}: "type" must be one of ${WEBMCP_CREATE_CARD_TYPES.join(", ")}`
    );
  }
  if (url !== undefined && typeof url !== "string") {
    throw new Error(`${WEBMCP_CREATE_TOOL_NAME}: "url" must be a string`);
  }
  if (notes !== undefined && typeof notes !== "string") {
    throw new Error(`${WEBMCP_CREATE_TOOL_NAME}: "notes" must be a string`);
  }
  const cleanTags = normalizeTagList(WEBMCP_CREATE_TOOL_NAME, "tags", tags);
  const cleanUrl =
    typeof url === "string" && url.trim() ? url.trim() : undefined;
  const cleanNotes =
    typeof notes === "string" && notes.trim() ? notes.trim() : undefined;

  return {
    content: content.trim(),
    type: type ?? "text",
    ...(cleanUrl === undefined ? {} : { url: cleanUrl }),
    ...(cleanNotes === undefined ? {} : { notes: cleanNotes }),
    ...(cleanTags === undefined ? {} : { tags: cleanTags }),
  };
};

export interface WebMcpTagsArgs {
  add: string[];
  cardId: string;
  remove: string[];
}

export const normalizeTagsToolInput = (input: unknown): WebMcpTagsArgs => {
  if (!isRecord(input)) {
    throw new Error(`${WEBMCP_TAGS_TOOL_NAME}: input must be an object`);
  }
  const { cardId, add, remove } = input;
  if (typeof cardId !== "string" || !cardId.trim()) {
    throw new Error(
      `${WEBMCP_TAGS_TOOL_NAME}: "cardId" must be a non-empty string`
    );
  }
  const cleanAdd = normalizeTagList(WEBMCP_TAGS_TOOL_NAME, "add", add) ?? [];
  const cleanRemove =
    normalizeTagList(WEBMCP_TAGS_TOOL_NAME, "remove", remove) ?? [];
  if (cleanAdd.length === 0 && cleanRemove.length === 0) {
    throw new Error(
      `${WEBMCP_TAGS_TOOL_NAME}: at least one of "add" or "remove" must be non-empty`
    );
  }
  const overlap = cleanAdd.filter((tag) => cleanRemove.includes(tag));
  if (overlap.length > 0) {
    throw new Error(
      `${WEBMCP_TAGS_TOOL_NAME}: cannot both add and remove ${overlap.join(", ")}`
    );
  }
  return { add: cleanAdd, cardId: cardId.trim(), remove: cleanRemove };
};

export interface WebMcpRecentArgs {
  limit: number;
  type?: CardType;
}

export const normalizeRecentToolInput = (input: unknown): WebMcpRecentArgs => {
  if (input !== undefined && !isRecord(input)) {
    throw new Error(`${WEBMCP_RECENT_TOOL_NAME}: input must be an object`);
  }
  const record = input ?? {};
  const { limit, type } = record as Record<string, unknown>;

  if (type !== undefined && !isCardType(type)) {
    throw new Error(
      `${WEBMCP_RECENT_TOOL_NAME}: "type" must be one of ${cardTypes.join(", ")}`
    );
  }
  if (
    limit !== undefined &&
    (typeof limit !== "number" || !Number.isInteger(limit))
  ) {
    throw new Error(`${WEBMCP_RECENT_TOOL_NAME}: "limit" must be an integer`);
  }

  return {
    limit: Math.min(
      Math.max(limit ?? WEBMCP_DEFAULT_LIMIT, 1),
      WEBMCP_MAX_LIMIT
    ),
    ...(type === undefined ? {} : { type }),
  };
};

export interface WebMcpFavoriteArgs {
  cardId: string;
  favorited: boolean;
}

export const normalizeFavoriteToolInput = (
  input: unknown
): WebMcpFavoriteArgs => {
  if (!isRecord(input)) {
    throw new Error(`${WEBMCP_FAVORITE_TOOL_NAME}: input must be an object`);
  }
  const { cardId, favorited } = input;
  if (typeof cardId !== "string" || !cardId.trim()) {
    throw new Error(
      `${WEBMCP_FAVORITE_TOOL_NAME}: "cardId" must be a non-empty string`
    );
  }
  if (typeof favorited !== "boolean") {
    throw new Error(
      `${WEBMCP_FAVORITE_TOOL_NAME}: "favorited" must be a boolean`
    );
  }
  return { cardId: cardId.trim(), favorited };
};

/**
 * Merge tag edits against stored tags. The server replaces the whole array,
 * so the tool computes the merged list: exact matching, stored order kept,
 * additions appended once.
 */
export const mergeCardTags = (
  current: readonly string[] | undefined,
  add: readonly string[],
  remove: readonly string[]
): string[] => {
  const removed = new Set(remove);
  const merged = (current ?? []).filter((tag) => !removed.has(tag));
  for (const tag of add) {
    if (!merged.includes(tag)) {
      merged.push(tag);
    }
  }
  return merged;
};

/** Structural subset of a card row the tools read. */
export interface WebMcpCardInput {
  _id: string;
  content: string;
  createdAt: number;
  isFavorited?: boolean;
  metadataTitle?: string;
  notes?: string | null;
  tags?: string[];
  type: string;
  updatedAt: number;
  url?: string;
}

export interface WebMcpCardSummary {
  createdAt: number;
  excerpt: string;
  id: string;
  isFavorited: boolean;
  tags: string[];
  title: string | null;
  type: string;
  updatedAt: number;
  url: string | null;
}

export interface WebMcpCardDetail extends WebMcpCardSummary {
  content: string;
  contentTruncated: boolean;
  notes: string | null;
}

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? value.slice(0, maxLength) : value;

export const toWebMcpCardSummary = (
  card: WebMcpCardInput
): WebMcpCardSummary => ({
  id: card._id,
  type: card.type,
  title: card.metadataTitle ?? null,
  url: card.url ?? null,
  excerpt: truncate(card.content, EXCERPT_LENGTH),
  tags: card.tags ?? [],
  isFavorited: card.isFavorited ?? false,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
});

export const toWebMcpCardDetail = (
  card: WebMcpCardInput
): WebMcpCardDetail => ({
  ...toWebMcpCardSummary(card),
  content: truncate(card.content, DETAIL_CONTENT_LENGTH),
  contentTruncated: card.content.length > DETAIL_CONTENT_LENGTH,
  notes: card.notes ?? null,
});

export interface WebMcpCreateCardInput {
  content: string;
  notes?: string;
  tags?: string[];
  type: WebMcpCreateCardType;
  url?: string;
}

export interface WebMcpUpdateFieldInput {
  cardId: string;
  field: "tags" | "isFavorited";
  value: unknown;
}

export interface WebMcpQueryDeps {
  createCard: (args: WebMcpCreateCardInput) => Promise<string>;
  getCard: (cardId: string) => Promise<WebMcpCardInput | null>;
  searchCards: (args: {
    searchQuery?: string;
    types?: CardType[];
    favoritesOnly?: boolean;
    limit?: number;
  }) => Promise<WebMcpCardInput[]>;
  updateCardField: (args: WebMcpUpdateFieldInput) => Promise<null>;
}

/**
 * Resolve the WebMCP entry point. The draft API moved from
 * `navigator.modelContext` to `document.modelContext`, so both are probed.
 */
export const getModelContext = (): WebMcpModelContext | null => {
  if (typeof document !== "undefined") {
    const withContext = document as Document & {
      modelContext?: WebMcpModelContext;
    };
    if (withContext.modelContext) {
      return withContext.modelContext;
    }
  }
  if (typeof navigator !== "undefined") {
    const withContext = navigator as Navigator & {
      modelContext?: WebMcpModelContext;
    };
    if (withContext.modelContext) {
      return withContext.modelContext;
    }
  }
  return null;
};

export interface RegisterWebMcpToolsOptions {
  logger?: (message: string) => void;
  signal?: AbortSignal;
}

const defaultLogger = (message: string): void => {
  if (process.env.NODE_ENV !== "production") {
    console.info(message);
  }
};

/** Register Teak's read-only WebMCP tools. Rejects when registration fails. */
export const registerTeakWebMcpTools = async (
  modelContext: WebMcpModelContext,
  deps: WebMcpQueryDeps,
  options: RegisterWebMcpToolsOptions = {}
): Promise<readonly string[]> => {
  const logger = options.logger ?? defaultLogger;
  // Card content and notes are user-generated, so read tools mark their
  // output untrusted per the Chrome secure-tools guidance.
  const readAnnotations: WebMcpToolAnnotations = {
    readOnlyHint: true,
    untrustedContentHint: true,
  };
  const writeAnnotations: WebMcpToolAnnotations = {
    consequentialHint: true,
  };
  const tools: WebMcpToolDefinition[] = [
    {
      name: WEBMCP_SEARCH_TOOL_NAME,
      title: "Search Teak cards",
      description: SEARCH_TOOL_DESCRIPTION,
      inputSchema: WEBMCP_SEARCH_INPUT_SCHEMA,
      annotations: readAnnotations,
      execute: async (input, { signal }) => {
        const args = normalizeSearchToolInput(input);
        const cards = await withAbort(WEBMCP_SEARCH_TOOL_NAME, signal, () =>
          deps.searchCards({
            ...(args.q === undefined ? {} : { searchQuery: args.q }),
            ...(args.type === undefined ? {} : { types: [args.type] }),
            ...(args.favorited === undefined
              ? {}
              : { favoritesOnly: args.favorited }),
            limit: args.limit,
          })
        );
        return {
          items: cards.map(toWebMcpCardSummary),
          total: cards.length,
        };
      },
    },
    {
      name: WEBMCP_GET_TOOL_NAME,
      title: "Get Teak card",
      description: GET_TOOL_DESCRIPTION,
      inputSchema: WEBMCP_GET_INPUT_SCHEMA,
      annotations: readAnnotations,
      execute: async (input, { signal }) => {
        const { cardId } = normalizeGetToolInput(input);
        const card = await withAbort(WEBMCP_GET_TOOL_NAME, signal, () =>
          deps.getCard(cardId)
        );
        return card ? toWebMcpCardDetail(card) : null;
      },
    },
    {
      name: WEBMCP_CREATE_TOOL_NAME,
      title: "Create Teak card",
      description: CREATE_TOOL_DESCRIPTION,
      inputSchema: WEBMCP_CREATE_INPUT_SCHEMA,
      annotations: writeAnnotations,
      execute: async (input, { signal }) => {
        throwIfAborted(WEBMCP_CREATE_TOOL_NAME, signal);
        const args = normalizeCreateToolInput(input);
        const id = await deps.createCard({
          content: args.content,
          type: args.type,
          ...(args.url === undefined ? {} : { url: args.url }),
          ...(args.notes === undefined ? {} : { notes: args.notes }),
          ...(args.tags === undefined ? {} : { tags: args.tags }),
        });
        // The server may classify the type and extract URLs, so confirm
        // the stored shape instead of echoing the request. A missing
        // read-back is reported, never papered over with request values.
        const card = await deps.getCard(id);
        if (!card) {
          throw new Error(
            `${WEBMCP_CREATE_TOOL_NAME}: card ${id} was created but could not be read back`
          );
        }
        return {
          id,
          type: card.type,
          url: card.url ?? null,
          tags: card.tags ?? [],
        };
      },
    },
    {
      name: WEBMCP_TAGS_TOOL_NAME,
      title: "Update Teak card tags",
      description: TAGS_TOOL_DESCRIPTION,
      inputSchema: WEBMCP_TAGS_INPUT_SCHEMA,
      annotations: writeAnnotations,
      execute: async (input, { signal }) => {
        throwIfAborted(WEBMCP_TAGS_TOOL_NAME, signal);
        const args = normalizeTagsToolInput(input);
        const card = await deps.getCard(args.cardId);
        if (!card) {
          throw new Error(`${WEBMCP_TAGS_TOOL_NAME}: card not found`);
        }
        // Read-merge-write matches the app's own tag editing (CardsScreen
        // handleAddTag/handleRemoveTag): single-user, tab-scoped calls with
        // a fresh read per call. Concurrent same-card edits can overwrite
        // each other; an atomic merge would need a server-side patch
        // mutation, which is out of scope for this web-only change.
        const merged = mergeCardTags(card.tags, args.add, args.remove);
        await deps.updateCardField({
          cardId: card._id,
          field: "tags",
          value: merged,
        });
        return { id: args.cardId, tags: merged };
      },
    },
    {
      name: WEBMCP_FAVORITE_TOOL_NAME,
      title: "Set Teak card favorite",
      description: FAVORITE_TOOL_DESCRIPTION,
      inputSchema: WEBMCP_FAVORITE_INPUT_SCHEMA,
      annotations: writeAnnotations,
      execute: async (input, { signal }) => {
        throwIfAborted(WEBMCP_FAVORITE_TOOL_NAME, signal);
        const args = normalizeFavoriteToolInput(input);
        const card = await deps.getCard(args.cardId);
        if (!card) {
          throw new Error(`${WEBMCP_FAVORITE_TOOL_NAME}: card not found`);
        }
        await deps.updateCardField({
          cardId: card._id,
          field: "isFavorited",
          value: args.favorited,
        });
        return { id: args.cardId, isFavorited: args.favorited };
      },
    },
    {
      name: WEBMCP_RECENT_TOOL_NAME,
      title: "List recent Teak cards",
      description: RECENT_TOOL_DESCRIPTION,
      inputSchema: WEBMCP_RECENT_INPUT_SCHEMA,
      annotations: readAnnotations,
      execute: async (input, { signal }) => {
        const args = normalizeRecentToolInput(input);
        // The backend orders index-descending before taking the limit, so
        // this is already the newest slice; the client sort only normalizes
        // by the createdAt field (which imports can backdate).
        const cards = await withAbort(WEBMCP_RECENT_TOOL_NAME, signal, () =>
          deps.searchCards({
            ...(args.type === undefined ? {} : { types: [args.type] }),
            limit: args.limit,
          })
        );
        const sorted = [...cards].sort((a, b) => b.createdAt - a.createdAt);
        const items = sorted.slice(0, args.limit).map(toWebMcpCardSummary);
        return { items, total: items.length };
      },
    },
  ];

  for (const tool of tools) {
    await modelContext.registerTool(
      tool,
      options.signal ? { signal: options.signal } : undefined
    );
  }
  logger(`[webmcp] registered tools: ${WEBMCP_TOOL_NAMES.join(", ")}`);
  return WEBMCP_TOOL_NAMES;
};
