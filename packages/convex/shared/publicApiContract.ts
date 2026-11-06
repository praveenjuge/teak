/**
 * The public API's operations and the values its inputs take, in one place.
 * The Convex router, the OpenAPI document, the MCP server, the SDK, the CLI
 * and the Core Worker read them from here, so an operation is declared once.
 */
import { cardTypes } from "./constants";
import { CARD_LIST_SORTS } from "./search/sort";

export {
  PUBLIC_API_DEFAULT_LIMIT,
  PUBLIC_API_MAX_BULK_ITEMS,
  PUBLIC_API_MAX_LIMIT,
} from "./publicApiLimits";
export { SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION as MAX_VISUAL_FILTERS } from "./search/constants";
export { MAX_SHUFFLE_SEED } from "./search/shuffle";

export type PublicApiMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface PublicApiOperationSpec {
  /** Whether the operation reads a JSON request body. */
  readonly body?: true;
  readonly method: PublicApiMethod;
  /** OpenAPI path template: `{name}` marks a path parameter. */
  readonly path: string;
}

/** Every public operation, by its OpenAPI `operationId`, in document order. */
export const PUBLIC_API_OPERATIONS = {
  disconnectOAuthConsent: { method: "POST", path: "/v1/oauth/disconnect" },
  getMe: { method: "GET", path: "/v1/me" },
  getHealth: { method: "GET", path: "/healthz" },
  getApiDiscovery: { method: "GET", path: "/v1" },
  listCards: { method: "GET", path: "/v1/cards" },
  createCard: { method: "POST", path: "/v1/cards", body: true },
  createUpload: { method: "POST", path: "/v1/uploads", body: true },
  createPageSnapshotUpload: {
    method: "POST",
    path: "/v1/page-snapshots/upload",
    body: true,
  },
  bulkCards: { method: "POST", path: "/v1/cards/bulk", body: true },
  listCardChanges: { method: "GET", path: "/v1/cards/changes" },
  reorderPinnedCards: {
    method: "PUT",
    path: "/v1/cards/pinned/order",
    body: true,
  },
  findDuplicateCard: { method: "GET", path: "/v1/cards/duplicate" },
  getCard: { method: "GET", path: "/v1/cards/{cardId}" },
  updateCard: { method: "PATCH", path: "/v1/cards/{cardId}", body: true },
  deleteCard: { method: "DELETE", path: "/v1/cards/{cardId}" },
  restoreCard: { method: "POST", path: "/v1/cards/{cardId}/restore" },
  getCardContent: { method: "GET", path: "/v1/cards/{cardId}/content" },
  refreshCard: { method: "POST", path: "/v1/cards/{cardId}/refresh" },
  createThumbnailUpload: {
    method: "POST",
    path: "/v1/cards/{cardId}/thumbnail/upload",
    body: true,
  },
  setCardThumbnail: {
    method: "PUT",
    path: "/v1/cards/{cardId}/thumbnail",
    body: true,
  },
  resetCardThumbnail: {
    method: "DELETE",
    path: "/v1/cards/{cardId}/thumbnail",
  },
  markCardDone: { method: "POST", path: "/v1/cards/{cardId}/done" },
  unmarkCardDone: { method: "DELETE", path: "/v1/cards/{cardId}/done" },
  saveCardPdf: { method: "POST", path: "/v1/cards/{cardId}/save-pdf" },
  setCardFavorite: {
    method: "PATCH",
    path: "/v1/cards/{cardId}/favorite",
    body: true,
  },
  setCardPinned: {
    method: "PATCH",
    path: "/v1/cards/{cardId}/pin",
    body: true,
  },
  listTags: { method: "GET", path: "/v1/tags" },
  renameTag: { method: "POST", path: "/v1/tags/rename", body: true },
  mergeTags: { method: "POST", path: "/v1/tags/merge", body: true },
  deleteTag: { method: "POST", path: "/v1/tags/delete", body: true },
  getTagOperation: {
    method: "GET",
    path: "/v1/tags/operations/{operationId}",
  },
  listFolders: { method: "GET", path: "/v1/folders" },
  createFolder: { method: "POST", path: "/v1/folders", body: true },
  getFolder: { method: "GET", path: "/v1/folders/{folderId}" },
  updateFolder: {
    method: "PATCH",
    path: "/v1/folders/{folderId}",
    body: true,
  },
  deleteFolder: { method: "DELETE", path: "/v1/folders/{folderId}" },
  addCardsToFolder: {
    method: "POST",
    path: "/v1/folders/{folderId}/cards",
    body: true,
  },
  removeCardsFromFolder: {
    method: "DELETE",
    path: "/v1/folders/{folderId}/cards",
    body: true,
  },
  getFolderRuleRun: {
    method: "GET",
    path: "/v1/folders/{folderId}/rule-runs/{runId}",
  },
  undoFolderRuleRun: {
    method: "POST",
    path: "/v1/folders/{folderId}/rule-runs/{runId}/undo",
  },
  listHighlights: { method: "GET", path: "/v1/cards/{cardId}/highlights" },
  createHighlight: {
    method: "POST",
    path: "/v1/cards/{cardId}/highlights",
    body: true,
  },
  updateHighlight: {
    method: "PATCH",
    path: "/v1/highlights/{highlightId}",
    body: true,
  },
  deleteHighlight: { method: "DELETE", path: "/v1/highlights/{highlightId}" },
  startExport: { method: "POST", path: "/v1/exports" },
  getLatestExport: { method: "GET", path: "/v1/exports/latest" },
} as const satisfies Record<string, PublicApiOperationSpec>;

export type PublicApiOperationId = keyof typeof PUBLIC_API_OPERATIONS;

export const PUBLIC_API_OPERATION_IDS = Object.keys(
  PUBLIC_API_OPERATIONS
) as PublicApiOperationId[];

export type PublicApiQueryValue =
  | boolean
  | number
  | string
  | readonly string[]
  | undefined;

/** One call to an operation by id, with its inputs as values. */
export interface PublicApiOperationCall {
  body?: unknown;
  headers?: HeadersInit;
  operationId: PublicApiOperationId;
  params?: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, PublicApiQueryValue>>;
}

const OPERATION_SPECS = new Map<PublicApiOperationId, PublicApiOperationSpec>(
  Object.entries(PUBLIC_API_OPERATIONS) as [
    PublicApiOperationId,
    PublicApiOperationSpec,
  ][]
);

/** An operation's method, path and body rule. */
export const publicApiOperationSpec = (
  id: PublicApiOperationId
): PublicApiOperationSpec => {
  const spec = OPERATION_SPECS.get(id);
  if (!spec) {
    throw new Error(`Unknown public API operation: ${id}`);
  }
  return spec;
};

const operationSpec = publicApiOperationSpec;

/** The names of an operation's path parameters, in path order. */
export const publicApiPathParams = (id: PublicApiOperationId): string[] =>
  operationSpec(id)
    .path.split("/")
    .filter((segment) => segment.startsWith("{"))
    .map((segment) => segment.slice(1, -1));

/** An operation's path with its parameters filled in and encoded. */
export const publicApiPath = (
  id: PublicApiOperationId,
  params: Readonly<Record<string, string>> = {}
): string =>
  operationSpec(id)
    .path.split("/")
    .map((segment) => {
      if (!segment.startsWith("{")) {
        return segment;
      }
      const name = segment.slice(1, -1);
      const value = params[name];
      if (!value) {
        throw new Error(`${id} needs the path parameter ${name}`);
      }
      return encodeURIComponent(value);
    })
    .join("/");

/** `GET /v1/cards/:cardId`: how `GET /v1` lists an operation. */
export const publicApiEndpointLabel = (id: PublicApiOperationId): string => {
  const { method, path } = operationSpec(id);
  return `${method} ${path.replace(/\{(\w+)\}/g, ":$1")}`;
};

interface CompiledOperation {
  id: PublicApiOperationId;
  method: PublicApiMethod;
  segments: string[];
  staticSegments: number;
}

const COMPILED: CompiledOperation[] = PUBLIC_API_OPERATION_IDS.map((id) => {
  const segments = operationSpec(id).path.split("/");
  return {
    id,
    method: operationSpec(id).method,
    segments,
    staticSegments: segments.filter((segment) => !segment.startsWith("{"))
      .length,
  };
})
  // A path written out wins over a template it also fits, so
  // `/v1/cards/changes` is never read as the card `changes`.
  .sort((left, right) => right.staticSegments - left.staticSegments);

const matchSegments = (
  operation: CompiledOperation,
  parts: readonly string[]
): Record<string, string> | null => {
  if (operation.segments.length !== parts.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [index, segment] of operation.segments.entries()) {
    const part = parts[index] ?? "";
    if (!segment.startsWith("{")) {
      if (segment !== part) {
        return null;
      }
      continue;
    }
    if (!part) {
      return null;
    }
    try {
      params[segment.slice(1, -1)] = decodeURIComponent(part);
    } catch {
      return null;
    }
  }
  return params;
};

export interface PublicApiMatch {
  operationId: PublicApiOperationId;
  params: Record<string, string>;
}

/** The operation a request reaches, with its decoded path parameters. */
export const matchPublicApiOperation = (
  method: string,
  pathname: string
): PublicApiMatch | null => {
  const parts = pathname.split("/");
  for (const operation of COMPILED) {
    if (operation.method !== method) {
      continue;
    }
    const params = matchSegments(operation, parts);
    if (params) {
      return { operationId: operation.id, params };
    }
  }
  return null;
};

const METHOD_ORDER: readonly PublicApiMethod[] = [
  "GET",
  "POST",
  "PATCH",
  "PUT",
  "DELETE",
];

/**
 * The methods the API serves on a path, or none when it isn't one of its
 * endpoints: 405 against 404 for a request no operation takes.
 */
export const publicApiMethodsFor = (pathname: string): PublicApiMethod[] => {
  const parts = pathname.split("/");
  const methods = new Set(
    COMPILED.filter((operation) => matchSegments(operation, parts)).map(
      (operation) => operation.method
    )
  );
  return METHOD_ORDER.filter((method) => methods.has(method));
};

export const PUBLIC_API_CARD_TYPES = cardTypes;
export const PUBLIC_API_CARD_SORTS = CARD_LIST_SORTS;
/**
 * The query parameters `listCards` takes, which every surface offers. The
 * CLI names its flag after the parameter in kebab case unless `cliFlag`
 * says otherwise.
 */
export const CARD_LIST_PARAMS = {
  q: { cliFlag: "--query" },
  similarTo: {},
  mode: {},
  limit: {},
  cursor: { cliFlag: "--next" },
  sort: {},
  shuffleSeed: { cliFlag: "--seed" },
  type: {},
  tag: {},
  favorited: {},
  pinned: {},
  trashed: {},
  folder: {},
  archived: {},
  style: {},
  hue: {},
  hex: {},
  createdAfter: {},
  createdBefore: {},
  include: {},
} as const satisfies Record<string, { cliFlag?: string }>;
export type CardListParam = keyof typeof CARD_LIST_PARAMS;

export const cliFlagFor = (param: CardListParam): string =>
  (CARD_LIST_PARAMS[param] as { cliFlag?: string }).cliFlag ??
  `--${param.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

export const ARCHIVED_FILTERS = ["exclude", "only", "include"] as const;
export type ArchivedFilter = (typeof ARCHIVED_FILTERS)[number];
export const CARD_LIST_INCLUDES = [
  "content",
  "metadata",
  "processing",
] as const;
export type CardListInclude = (typeof CARD_LIST_INCLUDES)[number];
export const CARD_CONTENT_KINDS = [
  "article",
  "document",
  "transcript",
  "content",
] as const;
export const BULK_CARD_OPERATIONS = [
  "create",
  "update",
  "favorite",
  "delete",
  "archive",
  "unarchive",
  "addTags",
  "removeTags",
  "restore",
] as const;
export type BulkCardOperation = (typeof BULK_CARD_OPERATIONS)[number];
/** How a search finds cards: words and meaning, words only, meaning only. */
export const SEARCH_MODES = ["hybrid", "keyword", "semantic"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

/** Every `code` an API error body can carry. */
export const PUBLIC_API_ERROR_CODES = [
  "BAD_REQUEST",
  "CARD_LIMIT_REACHED",
  "CONFLICT",
  "CONTENT_TOO_LARGE",
  "FILE_TOO_LARGE",
  "FOLDER_LIMIT",
  "FORBIDDEN",
  "HIGHLIGHT_LIMIT",
  "IN_PROGRESS",
  "INTERNAL_ERROR",
  "INVALID_API_KEY",
  "INVALID_INPUT",
  "INVALID_STORAGE_KEY",
  "INVALID_UTF8",
  "LIMIT_REACHED",
  "METHOD_NOT_ALLOWED",
  "NOT_FOUND",
  "NO_ARTICLE",
  "NO_CONTENT",
  "NOT_IN_TRASH",
  "PAGE_SNAPSHOT_TOO_LARGE",
  "PIN_LIMIT_REACHED",
  "QUOTE_NOT_FOUND",
  "TAG_EXISTS",
  "TAG_OPERATION_RUNNING",
  "RATE_LIMITED",
  "RULE_LIMIT",
  "SERVICE_UNAVAILABLE",
  "SMART_FOLDER",
  "TYPE_MISMATCH",
  "UNAUTHORIZED",
  "UNSUPPORTED_TYPE",
] as const;
export type PublicApiErrorCode = (typeof PUBLIC_API_ERROR_CODES)[number];

/**
 * Card error codes the API never returns: the web app's limit on files in
 * one drop. The API saves one file per card.
 */
export const APP_ONLY_CARD_ERROR_CODES = ["TOO_MANY_FILES"] as const;

/** OAuth discovery documents, served beside the API and the MCP server. */
export const TEAK_OAUTH_CLIENTS_PATH = "/.well-known/teak-oauth-clients.json";
export const OAUTH_PROTECTED_RESOURCE_PATH =
  "/.well-known/oauth-protected-resource";
export const OAUTH_PROTECTED_RESOURCE_PATHS = [
  OAUTH_PROTECTED_RESOURCE_PATH,
  `${OAUTH_PROTECTED_RESOURCE_PATH}/mcp`,
] as const;
export const WELL_KNOWN_PATHS = [
  ...OAUTH_PROTECTED_RESOURCE_PATHS,
  TEAK_OAUTH_CLIENTS_PATH,
] as const;
