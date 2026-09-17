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

export interface WebMcpToolDefinition {
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
  getTools?: () => Promise<{ name: string; description?: string }[]>;
  registerTool: (
    tool: WebMcpToolDefinition,
    options?: { signal?: AbortSignal }
  ) => Promise<void>;
}

/** Tool names are prefixed like the remote MCP tools (`teak_v1_*`). */
export const WEBMCP_SEARCH_TOOL_NAME = "teak_search_cards";
export const WEBMCP_GET_TOOL_NAME = "teak_get_card";

export const WEBMCP_TOOL_NAMES = [
  WEBMCP_SEARCH_TOOL_NAME,
  WEBMCP_GET_TOOL_NAME,
] as const;

// Tool descriptions are a prompt-injection surface (spec section 6.3.1), so
// they stay static strings and never interpolate user data.
const SEARCH_TOOL_DESCRIPTION =
  "Search the signed-in user's Teak cards by keyword, with optional card-type and favorites filters. Returns matching card summaries.";
const GET_TOOL_DESCRIPTION =
  "Get one Teak card by ID for the signed-in user. Returns the card detail, or null when the ID does not exist.";

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

export interface WebMcpQueryDeps {
  getCard: (cardId: string) => Promise<WebMcpCardInput | null>;
  searchCards: (args: {
    searchQuery?: string;
    types?: CardType[];
    favoritesOnly?: boolean;
    limit?: number;
  }) => Promise<WebMcpCardInput[]>;
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
  const tools: WebMcpToolDefinition[] = [
    {
      name: WEBMCP_SEARCH_TOOL_NAME,
      title: "Search Teak cards",
      description: SEARCH_TOOL_DESCRIPTION,
      inputSchema: WEBMCP_SEARCH_INPUT_SCHEMA,
      execute: async (input) => {
        const args = normalizeSearchToolInput(input);
        const cards = await deps.searchCards({
          ...(args.q === undefined ? {} : { searchQuery: args.q }),
          ...(args.type === undefined ? {} : { types: [args.type] }),
          ...(args.favorited === undefined
            ? {}
            : { favoritesOnly: args.favorited }),
          limit: args.limit,
        });
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
      execute: async (input) => {
        const { cardId } = normalizeGetToolInput(input);
        const card = await deps.getCard(cardId);
        return card ? toWebMcpCardDetail(card) : null;
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
