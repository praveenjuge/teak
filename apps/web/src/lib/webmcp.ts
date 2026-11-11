import type { Id } from "@teak/convex/_generated/dataModel";
import { type CardType, cardTypes } from "@teak/convex/shared/constants";
import { MAX_PINNED_CARDS } from "@teak/convex/shared/pins";

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

export const subscribeWebMcpToolEvents = (
  modelContext: WebMcpModelContext,
  onEvent: (type: WebMcpToolEventType) => void
): (() => void) => {
  const addListener = modelContext.addEventListener?.bind(modelContext);
  const removeListener = modelContext.removeEventListener?.bind(modelContext);
  if (!(addListener && removeListener)) {
    return () => undefined;
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

export const WEBMCP_SEARCH_TOOL_NAME = "teak_search_cards";
export const WEBMCP_GET_TOOL_NAME = "teak_get_card";
export const WEBMCP_CREATE_TOOL_NAME = "teak_create_card";
export const WEBMCP_TAGS_TOOL_NAME = "teak_update_tags";
export const WEBMCP_FAVORITE_TOOL_NAME = "teak_set_favorite";
export const WEBMCP_PIN_TOOL_NAME = "teak_set_pinned";
export const WEBMCP_RECENT_TOOL_NAME = "teak_recent_cards";

export const WEBMCP_TOOL_NAMES = [
  WEBMCP_SEARCH_TOOL_NAME,
  WEBMCP_GET_TOOL_NAME,
  WEBMCP_CREATE_TOOL_NAME,
  WEBMCP_TAGS_TOOL_NAME,
  WEBMCP_FAVORITE_TOOL_NAME,
  WEBMCP_RECENT_TOOL_NAME,
  WEBMCP_PIN_TOOL_NAME,
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
  "Add or remove tags on one Teak card for the signed-in user. Tags match ignoring case; tags not mentioned are kept. Returns the updated tag list.";
const FAVORITE_TOOL_DESCRIPTION =
  "Set or clear the favorite flag on one Teak card for the signed-in user. Returns the updated flag.";
const PIN_TOOL_DESCRIPTION = `Pin one Teak card to the top of the signed-in user's library, or unpin it. Up to ${MAX_PINNED_CARDS} cards can be pinned, and archived cards can't be. Returns the updated flag.`;
const RECENT_TOOL_DESCRIPTION =
  "List the signed-in user's most recently created Teak cards, newest first, with an optional card-type filter. Returns matching card summaries.";

export const WEBMCP_CREATE_CARD_TYPES = ["text", "quote", "link"] as const;

export type WebMcpCreateCardType = (typeof WEBMCP_CREATE_CARD_TYPES)[number];

export const WEBMCP_DEFAULT_LIMIT = 20;
export const WEBMCP_MAX_LIMIT = 50;

/**
 * One input field, written once: its JSON schema and the check `execute` runs
 * on what an agent sends both come from it.
 */
type ToolField =
  | { kind: "string"; description: string; nonEmpty?: true }
  | { kind: "integer"; description: string; minimum: number; maximum: number }
  | { kind: "boolean"; description: string }
  | { kind: "enum"; description: string; values: readonly string[] }
  | { kind: "strings"; description: string };

/** A tool's input. With no required field, the whole input may be left out. */
interface ToolInput {
  fields: Record<string, ToolField>;
  required?: readonly string[];
}

const fieldSchema = (field: ToolField): Record<string, unknown> => {
  switch (field.kind) {
    case "string":
      return {
        type: "string",
        ...(field.nonEmpty ? { minLength: 1 } : {}),
        description: field.description,
      };
    case "integer":
      return {
        type: "integer",
        minimum: field.minimum,
        maximum: field.maximum,
        description: field.description,
      };
    case "boolean":
      return { type: "boolean", description: field.description };
    case "enum":
      return {
        type: "string",
        enum: [...field.values],
        description: field.description,
      };
    case "strings":
      return {
        type: "array",
        items: { type: "string" },
        description: field.description,
      };
    default:
      return field satisfies never;
  }
};

const toolInputSchema = ({
  fields,
  required,
}: ToolInput): WebMcpToolInputSchema => ({
  type: "object",
  properties: Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [name, fieldSchema(field)])
  ),
  ...(required ? { required: [...required] } : {}),
  additionalProperties: false,
});

/** What is wrong with `value` for `field`, or null when it fits. */
const fieldProblem = (field: ToolField, value: unknown): string | null => {
  switch (field.kind) {
    case "string":
      if (field.nonEmpty) {
        return typeof value === "string" && value.trim()
          ? null
          : "must be a non-empty string";
      }
      return typeof value === "string" ? null : "must be a string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? null
        : "must be an integer";
    case "boolean":
      return typeof value === "boolean" ? null : "must be a boolean";
    case "enum":
      return typeof value === "string" && field.values.includes(value)
        ? null
        : `must be one of ${field.values.join(", ")}`;
    case "strings":
      return Array.isArray(value) &&
        value.every((item) => typeof item === "string")
        ? null
        : "must be an array of strings";
    default:
      return field satisfies never;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Checks `input` against the tool's fields; later rules are the caller's. */
const readToolInput = (
  toolName: string,
  { fields, required = [] }: ToolInput,
  input: unknown
): Record<string, unknown> => {
  if (input === undefined && required.length === 0) {
    return {};
  }
  if (!isRecord(input)) {
    throw new Error(`${toolName}: input must be an object`);
  }
  for (const [name, field] of Object.entries(fields)) {
    const value = input[name];
    if (value === undefined && !required.includes(name)) {
      continue;
    }
    const problem = fieldProblem(field, value);
    if (problem) {
      throw new Error(`${toolName}: "${name}" ${problem}`);
    }
  }
  return input;
};

const CARD_ID_FIELD: ToolField = {
  kind: "string",
  nonEmpty: true,
  description: "The Teak card ID.",
};
const LIMIT_FIELD: ToolField = {
  kind: "integer",
  minimum: 1,
  maximum: WEBMCP_MAX_LIMIT,
  description: "Maximum cards to return. Defaults to 20.",
};
const TYPE_FILTER_FIELD: ToolField = {
  kind: "enum",
  values: cardTypes,
  description: "Only return cards of this type.",
};

const SEARCH_INPUT: ToolInput = {
  fields: {
    q: {
      kind: "string",
      description: "Keyword query. Omit or leave blank to list recent cards.",
    },
    limit: LIMIT_FIELD,
    type: TYPE_FILTER_FIELD,
    favorited: {
      kind: "boolean",
      description: "When true, only return favorited cards.",
    },
  },
};

const GET_INPUT: ToolInput = {
  fields: { cardId: CARD_ID_FIELD },
  required: ["cardId"],
};

const CREATE_INPUT: ToolInput = {
  fields: {
    content: {
      kind: "string",
      nonEmpty: true,
      description: "The card content. Required.",
    },
    type: {
      kind: "enum",
      values: WEBMCP_CREATE_CARD_TYPES,
      description: "The card type. Defaults to text.",
    },
    url: { kind: "string", description: "Source URL, used by link cards." },
    notes: {
      kind: "string",
      description: "Private notes attached to the card.",
    },
    tags: { kind: "strings", description: "Tags attached to the card." },
  },
  required: ["content"],
};

const TAGS_INPUT: ToolInput = {
  fields: {
    cardId: CARD_ID_FIELD,
    add: {
      kind: "strings",
      description: "Tags to add. At least one of add or remove is required.",
    },
    remove: {
      kind: "strings",
      description: "Tags to remove, matched exactly.",
    },
  },
  required: ["cardId"],
};

const FAVORITE_INPUT: ToolInput = {
  fields: {
    cardId: CARD_ID_FIELD,
    favorited: {
      kind: "boolean",
      description: "True to favorite the card, false to unfavorite it.",
    },
  },
  required: ["cardId", "favorited"],
};

const RECENT_INPUT: ToolInput = {
  fields: { limit: LIMIT_FIELD, type: TYPE_FILTER_FIELD },
};

const PIN_INPUT: ToolInput = {
  fields: {
    cardId: CARD_ID_FIELD,
    pinned: {
      kind: "boolean",
      description: "True to pin the card to the top, false to unpin it.",
    },
  },
  required: ["cardId", "pinned"],
};

export const WEBMCP_SEARCH_INPUT_SCHEMA = toolInputSchema(SEARCH_INPUT);
export const WEBMCP_GET_INPUT_SCHEMA = toolInputSchema(GET_INPUT);
export const WEBMCP_CREATE_INPUT_SCHEMA = toolInputSchema(CREATE_INPUT);
export const WEBMCP_TAGS_INPUT_SCHEMA = toolInputSchema(TAGS_INPUT);
export const WEBMCP_FAVORITE_INPUT_SCHEMA = toolInputSchema(FAVORITE_INPUT);
export const WEBMCP_RECENT_INPUT_SCHEMA = toolInputSchema(RECENT_INPUT);
export const WEBMCP_PIN_INPUT_SCHEMA = toolInputSchema(PIN_INPUT);

const EXCERPT_LENGTH = 280;
const DETAIL_CONTENT_LENGTH = 8000;

const throwIfAborted = (toolName: string, signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new DOMException(
      `${toolName}: tool execution was cancelled`,
      "AbortError"
    );
  }
};

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

const clampLimit = (limit: number | undefined) =>
  Math.min(Math.max(limit ?? WEBMCP_DEFAULT_LIMIT, 1), WEBMCP_MAX_LIMIT);

const trimmedOrUndefined = (value: string | undefined) =>
  value?.trim() ? value.trim() : undefined;

const cleanTags = (tags: string[] | undefined): string[] =>
  (tags ?? []).map((tag) => tag.trim()).filter(Boolean);

export interface WebMcpSearchArgs {
  favorited?: boolean;
  limit: number;
  q?: string;
  type?: CardType;
}

export const normalizeSearchToolInput = (input: unknown): WebMcpSearchArgs => {
  const { q, limit, type, favorited } = readToolInput(
    WEBMCP_SEARCH_TOOL_NAME,
    SEARCH_INPUT,
    input
  ) as Partial<WebMcpSearchArgs>;
  const query = trimmedOrUndefined(q);
  return {
    ...(query === undefined ? {} : { q: query }),
    limit: clampLimit(limit),
    ...(type === undefined ? {} : { type }),
    ...(favorited === undefined ? {} : { favorited }),
  };
};

export const normalizeGetToolInput = (input: unknown): { cardId: string } => {
  const { cardId } = readToolInput(WEBMCP_GET_TOOL_NAME, GET_INPUT, input) as {
    cardId: string;
  };
  return { cardId: cardId.trim() };
};

export interface WebMcpCreateArgs {
  content: string;
  notes?: string;
  tags?: string[];
  type: WebMcpCreateCardType;
  url?: string;
}

export const normalizeCreateToolInput = (input: unknown): WebMcpCreateArgs => {
  const { content, type, url, notes, tags } = readToolInput(
    WEBMCP_CREATE_TOOL_NAME,
    CREATE_INPUT,
    input
  ) as Partial<WebMcpCreateArgs> & { content: string };
  const cleanUrl = trimmedOrUndefined(url);
  const cleanNotes = trimmedOrUndefined(notes);
  const kept = cleanTags(tags);
  return {
    content: content.trim(),
    type: type ?? "text",
    ...(cleanUrl === undefined ? {} : { url: cleanUrl }),
    ...(cleanNotes === undefined ? {} : { notes: cleanNotes }),
    ...(kept.length === 0 ? {} : { tags: kept }),
  };
};

export interface WebMcpTagsArgs {
  add: string[];
  cardId: string;
  remove: string[];
}

export const normalizeTagsToolInput = (input: unknown): WebMcpTagsArgs => {
  const { cardId, add, remove } = readToolInput(
    WEBMCP_TAGS_TOOL_NAME,
    TAGS_INPUT,
    input
  ) as { add?: string[]; cardId: string; remove?: string[] };
  const cleanAdd = cleanTags(add);
  const cleanRemove = cleanTags(remove);
  if (cleanAdd.length === 0 && cleanRemove.length === 0) {
    throw new Error(
      `${WEBMCP_TAGS_TOOL_NAME}: at least one of "add" or "remove" must be non-empty`
    );
  }
  const removing = new Set(cleanRemove.map((tag) => tag.toLowerCase()));
  const overlap = cleanAdd.filter((tag) => removing.has(tag.toLowerCase()));
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
  const { limit, type } = readToolInput(
    WEBMCP_RECENT_TOOL_NAME,
    RECENT_INPUT,
    input
  ) as Partial<WebMcpRecentArgs>;
  return {
    limit: clampLimit(limit),
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
  const { cardId, favorited } = readToolInput(
    WEBMCP_FAVORITE_TOOL_NAME,
    FAVORITE_INPUT,
    input
  ) as unknown as WebMcpFavoriteArgs;
  return { cardId: cardId.trim(), favorited };
};

export interface WebMcpPinArgs {
  cardId: string;
  pinned: boolean;
}

export const normalizePinToolInput = (input: unknown): WebMcpPinArgs => {
  const { cardId, pinned } = readToolInput(
    WEBMCP_PIN_TOOL_NAME,
    PIN_INPUT,
    input
  ) as unknown as WebMcpPinArgs;
  return { cardId: cardId.trim(), pinned };
};

export interface WebMcpCardInput {
  _id: Id<"cards">;
  content: string;
  createdAt: number;
  isFavorited?: boolean;
  metadataTitle?: string;
  notes?: string | null;
  pinPosition?: number;
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
  isPinned: boolean;
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
  isPinned: card.pinPosition !== undefined,
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

export interface WebMcpQueryDeps {
  createCard: (args: WebMcpCreateCardInput) => Promise<Id<"cards">>;
  editCardTags: (args: {
    action: "addTags" | "removeTags";
    cardId: Id<"cards">;
    tags: string[];
  }) => Promise<{ failedIds: Id<"cards">[] }>;
  getCard: (cardId: string) => Promise<WebMcpCardInput | null>;
  searchCards: (args: {
    searchQuery?: string;
    types?: CardType[];
    favoritesOnly?: boolean;
    limit?: number;
    sort?: "newest";
  }) => Promise<WebMcpCardInput[]>;
  setCardFavorite: (args: {
    cardId: Id<"cards">;
    favorited: boolean;
  }) => Promise<null>;
  setCardPinned: (args: {
    cardId: Id<"cards">;
    pinned: boolean;
  }) => Promise<null>;
}

export interface RegisterWebMcpToolsOptions {
  logger?: (message: string) => void;
  signal?: AbortSignal;
}

const defaultLogger = (message: string): void => {
  if (process.env.NODE_ENV !== "production") {
    console.info(message);
  }
};

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
        const edits = [
          { action: "addTags", tags: args.add },
          { action: "removeTags", tags: args.remove },
        ] as const;
        for (const { action, tags } of edits) {
          if (tags.length === 0) {
            continue;
          }
          const { failedIds } = await deps.editCardTags({
            action,
            cardId: card._id,
            tags,
          });
          if (failedIds.length > 0) {
            throw new Error(`${WEBMCP_TAGS_TOOL_NAME}: card not found`);
          }
        }
        const updated = await deps.getCard(card._id);
        if (!updated) {
          throw new Error(`${WEBMCP_TAGS_TOOL_NAME}: card not found`);
        }
        return { id: args.cardId, tags: updated.tags ?? [] };
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
        await deps.setCardFavorite({
          cardId: card._id,
          favorited: args.favorited,
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
        const cards = await withAbort(WEBMCP_RECENT_TOOL_NAME, signal, () =>
          deps.searchCards({
            ...(args.type === undefined ? {} : { types: [args.type] }),
            limit: args.limit,
            sort: "newest",
          })
        );
        return { items: cards.map(toWebMcpCardSummary), total: cards.length };
      },
    },
    {
      name: WEBMCP_PIN_TOOL_NAME,
      title: "Pin Teak card",
      description: PIN_TOOL_DESCRIPTION,
      inputSchema: WEBMCP_PIN_INPUT_SCHEMA,
      annotations: writeAnnotations,
      execute: async (input, { signal }) => {
        throwIfAborted(WEBMCP_PIN_TOOL_NAME, signal);
        const args = normalizePinToolInput(input);
        const card = await deps.getCard(args.cardId);
        if (!card) {
          throw new Error(`${WEBMCP_PIN_TOOL_NAME}: card not found`);
        }
        await deps.setCardPinned({ cardId: card._id, pinned: args.pinned });
        return { id: args.cardId, isPinned: args.pinned };
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
