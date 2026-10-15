export {
  type AuthDiscovery,
  discoverAuthServer,
  type OAuthSurface,
  validateOAuthUrl,
} from "./authDiscovery";
export {
  type ConnectTokenResult,
  type ConnectTokens,
  createConnectAuthorizeUrl,
  createPkceChallenge,
  disconnectConnectGrant,
  fetchConnectOwnerId,
  randomBase64Url,
  requestConnectTokens,
  WORKOS_CONNECT_SCOPE,
} from "./workosConnect";

import { type CardType, cardTypes } from "../shared/constants";
import type { FileKind, FilePreviewFacts } from "../shared/fileFormats";

import type { FOLDER_COLORS } from "../shared/folders";

export type { CardType } from "../shared/constants";

export const CARD_TYPES = cardTypes;
export const CARD_SORTS = ["newest", "oldest", "shuffle"] as const;
export const ERROR_CODES = [
  "AUTH_REQUIRED",
  "BAD_REQUEST",
  "CARD_LIMIT_REACHED",
  "CONFIG_ERROR",
  "CONFLICT",
  "CONTENT_TOO_LARGE",
  "FILE_TOO_LARGE",
  "FOLDER_LIMIT",
  "FORBIDDEN",
  "INTERNAL_ERROR",
  "INVALID_API_KEY",
  "INVALID_INPUT",
  "INVALID_STORAGE_KEY",
  "INVALID_UTF8",
  "LIMIT_REACHED",
  "METHOD_NOT_ALLOWED",
  "NETWORK_ERROR",
  "NOT_FOUND",
  "NO_CONTENT",
  "NOT_IN_TRASH",
  "PARSE_ERROR",
  "RATE_LIMITED",
  "REQUEST_FAILED",
  "SERVICE_UNAVAILABLE",
  "SMART_FOLDER",
  "TAG_EXISTS",
  "TAG_OPERATION_RUNNING",
  "TIMEOUT",
  "TYPE_MISMATCH",
  "UNAUTHORIZED",
  "UNSUPPORTED_TYPE",
] as const;

export type CardSort = (typeof CARD_SORTS)[number];
/**
 * How a search finds cards: `hybrid` (the API's default) matches words and
 * meaning, `keyword` words only, `semantic` meaning only.
 */
export type SearchMode = "hybrid" | "keyword" | "semantic";
export type TeakApiErrorCode = (typeof ERROR_CODES)[number];
export type FetchLike = typeof fetch;
export interface TokenProvider {
  getAccessToken: () => Promise<string | null> | string | null;
  onUnauthorized?: (
    rejectedToken: string
  ) => Promise<string | null> | string | null;
}

export interface Card {
  aiSummary: string | null;
  aiTags: string[];
  aiTranscript: string | null;
  appUrl: string;
  /** When the card was archived, or null. */
  archivedAt: number | null;
  /** Bar heights 0-100: 45 for a grid card, 200 for a player. */
  audioWaveform: { detail: number[]; grid: number[] } | null;
  colors: Array<{ hex: string; name?: string }>;
  compactUrl: string | null;
  content: string;
  createdAt: number;
  detailUrl: string | null;
  fileExtension: string | null;
  fileKind: FileKind | null;
  fileLanguage: string | null;
  fileName: string | null;
  filePreview: FilePreviewFacts | null;
  fileSize: number | null;
  fileUrl: string | null;
  /** Ids of the folders the card is in. */
  folderIds: string[];
  id: string;
  /** Archived cards are hidden from the library but still count. */
  isArchived: boolean;
  isDeleted: boolean;
  isFavorited: boolean;
  linkAuthor: string | null;
  linkFacts: Array<{ label: string; value: string }>;
  linkPreviewImageUrl: string | null;
  linkPreviewMedia: Array<{
    type: "image" | "video";
    url: string;
    contentType?: string;
    width?: number;
    height?: number;
    posterUrl?: string;
    posterContentType?: string;
    posterWidth?: number;
    posterHeight?: number;
  }>;
  /**
   * A product link's price: `amount` in the page's currency, `currency` an
   * ISO 4217 code or null. Null for cards without a price.
   */
  linkPrice: { amount: number; currency: string | null } | null;
  linkPublishedAt: string | null;
  linkPublisher: string | null;
  linkSiteName: string | null;
  metadataDescription: string | null;
  metadataStatus: string | null;
  metadataTitle: string | null;
  mimeType: string | null;
  notes: string | null;
  placeholderUrl: string | null;
  processingStatus: Record<string, unknown> | null;
  screenshotUrl: string | null;
  tags: string[];
  thumbnailUrl: string | null;
  type: CardType | string;
  updatedAt: number;
  url: string | null;
  /** Hover preview strip, `frames * frameWidth` wide; the URL expires. */
  videoScrub: {
    frameHeight: number;
    frameWidth: number;
    frames: number;
    url: string;
  } | null;
}
export type CardListItem = Partial<Card> &
  Pick<
    Card,
    | "aiTags"
    | "appUrl"
    | "createdAt"
    | "id"
    | "isFavorited"
    | "tags"
    | "type"
    | "updatedAt"
  >;
export interface PageInfo {
  hasMore: boolean;
  nextCursor: string | null;
}
export interface CardsPage {
  items: CardListItem[];
  pageInfo: PageInfo;
  /** With a query: the mode that ran (`keyword` when meaning search could not). */
  searchMode?: SearchMode;
}
export interface CardChangesResponse {
  deletedIds: string[];
  items: Card[];
  pageInfo: PageInfo;
}
export interface TagSummary {
  count: number;
  name: string;
}
export type FolderColor = (typeof FOLDER_COLORS)[number];
export interface Folder {
  /**
   * Cards in a manual folder that are not archived or in Trash; null for a
   * smart folder, whose cards are found when listed.
   */
  cardCount: number | null;
  color: FolderColor | null;
  createdAt: number;
  id: string;
  /** Manual folders hold the cards put in them; smart ones save a search. */
  kind: "manual" | "smart";
  name: string;
  /** A smart folder's search; null for a manual folder. */
  query: string | null;
  updatedAt: number;
}
export type TagOperationKind = "rename" | "merge" | "delete";
export type TagOperationStatus = "running" | "completed" | "failed";
/** A library-wide tag rename, merge or delete, finished in the background. */
export interface TagOperation {
  /** Cards rewritten so far. */
  changed: number;
  completedAt: number | null;
  createdAt: number;
  error: string | null;
  /** The tag being changed, lowercased. */
  from: string;
  id: string;
  kind: TagOperationKind;
  /** Cards looked at so far. */
  processed: number;
  status: TagOperationStatus;
  /** The new name (rename) or the tag merged into (merge). */
  to: string | null;
  /** Cards carrying the tag when the change started. */
  total: number;
  updatedAt: number;
}
export interface FolderCardsResult {
  failedIds: string[];
  /** Failed cards that are already in the most folders a card can be in. */
  folderLimitIds: string[];
  updatedIds: string[];
}
export interface CreateCardInput {
  cardType?: CardType;
  content?: string;
  fileEtag?: string;
  fileKey?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  notes?: string | null;
  source?: string;
  tags?: string[];
  url?: string;
}
export interface UpdateCardInput {
  content?: string;
  /** Replaces the card's folders; an empty list takes it out of every folder. */
  folderIds?: string[];
  isArchived?: boolean;
  metadataTitle?: string | null;
  notes?: string | null;
  /** AI tags to drop. `tags` replaces only the card's own tags. */
  removeAiTags?: string[];
  tags?: string[];
  url?: string;
}
export interface Me {
  cardCount: number;
  /** Null on Pro, which has no card limit. */
  cardLimit: number | null;
  email: string;
  id: string;
  name?: string;
  plan: "free" | "pro";
  settingsUrl: string;
}
export interface ExportJob {
  cardCount: number | null;
  completedAt: number | null;
  createdAt: number;
  downloadUrl: string | null;
  expiresAt: number | null;
  failureClass: string | null;
  filesIncluded: number | null;
  filesOmitted: number | null;
  id: string;
  processedCount: number | null;
  sizeBytes: number | null;
  stage: "snapshotting" | "archiving" | null;
  status: "pending" | "running" | "ready" | "failed" | "canceled" | "expired";
  updatedAt: number;
}
export interface LatestExport {
  canStartNew: boolean;
  job: ExportJob | null;
  nextAvailableAt: number | null;
}
export interface RequestOptions {
  /** Makes a retried create or bulk request safe to repeat. */
  idempotencyKey?: string;
}
export interface CreateUploadInput {
  fileName: string;
  fileSize: number;
  mimeType: string;
}
export interface CreateUploadResponse {
  expiresIn: number;
  fileKey: string;
  maxFileSize: number;
  method: "PUT";
  uploadUrl: string;
}
export interface CreateCardResponse {
  appUrl: string;
  card?: Card;
  cardId: string;
  status: "created";
}
export interface RefreshCardResponse {
  cardId: string;
  requestedAt: number;
  status: "queued";
}
/** A card's full stored text (GET /v1/cards/:id/content). */
export interface CardContent {
  cardId: string;
  /** Characters in the full stored text. */
  charCount: number;
  /**
   * document: extracted from the card's file; transcript: its speech;
   * content: a text or quote card's written text.
   */
  kind: "document" | "transcript" | "content";
  text: string;
  /** The document is longer than Teak keeps. */
  truncated: boolean;
}
export type BulkCardsOperation =
  | "create"
  | "update"
  | "favorite"
  | "delete"
  | "archive"
  | "unarchive"
  | "addTags"
  | "removeTags"
  | "restore";
export interface BulkCardsResponse {
  /** The `cardId` of every item that failed, to retry just those. */
  failedIds: string[];
  operation: BulkCardsOperation;
  results: unknown[];
  summary: { failed: number; succeeded: number; total: number };
}
/** Archived cards outside Trash: left out by default. */
export type ArchivedFilter = "exclude" | "only" | "include";

export class TeakApiError extends Error {
  code: TeakApiErrorCode;
  requestId?: string;
  retryAt?: number;
  status?: number;

  constructor(
    code: TeakApiErrorCode,
    message?: string,
    init?: { requestId?: string; retryAt?: number; status?: number }
  ) {
    super(message || defaultErrorMessage(code));
    this.name = "TeakApiError";
    this.code = code;
    this.requestId = init?.requestId;
    this.retryAt = init?.retryAt;
    this.status = init?.status;
  }
}

export const staticTokenProvider = (token: string): TokenProvider => ({
  getAccessToken: () => token,
});

const defaultErrorMessage = (code: TeakApiErrorCode) => {
  switch (code) {
    case "AUTH_REQUIRED":
    case "INVALID_API_KEY":
    case "UNAUTHORIZED":
      return "Authentication is required. Run `teak login` or set TEAK_API_KEY.";
    case "RATE_LIMITED":
      return "Too many requests. Wait a moment and try again.";
    case "NETWORK_ERROR":
      return "Unable to reach Teak.";
    case "TIMEOUT":
      return "The Teak request timed out.";
    case "NOT_FOUND":
      return "Teak could not find that resource.";
    default:
      return "The Teak request failed.";
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");
const codeFrom = (
  value: unknown,
  fallback: TeakApiErrorCode
): TeakApiErrorCode =>
  typeof value === "string" &&
  (ERROR_CODES as readonly string[]).includes(value)
    ? (value as TeakApiErrorCode)
    : fallback;

export const normalizeLimit = (limit?: number): number => {
  if (!Number.isFinite(limit)) {
    return 50;
  }
  return Math.max(1, Math.min(Math.trunc(limit ?? 50), 100));
};

const byteLengthForBody = (bytes: BodyInit): number | null => {
  if (bytes instanceof ArrayBuffer) {
    return bytes.byteLength;
  }
  if (ArrayBuffer.isView(bytes)) {
    return bytes.byteLength;
  }
  if (typeof Blob !== "undefined" && bytes instanceof Blob) {
    return bytes.size;
  }
  if (typeof bytes === "string") {
    return new TextEncoder().encode(bytes).byteLength;
  }
  return null;
};

const asList = (value?: string | readonly string[]): readonly string[] => {
  if (Array.isArray(value)) {
    return value;
  }
  return typeof value === "string" ? [value] : [];
};

export const buildCardsSearchParams = (input: {
  archived?: ArchivedFilter;
  /** Only cards in this folder id. */
  folder?: string;
  createdAfter?: number;
  createdBefore?: number;
  cursor?: string;
  favorited?: boolean;
  hex?: string | readonly string[];
  hue?: string | readonly string[];
  include?: string;
  limit?: number;
  /** How `query` finds cards; the API defaults to `hybrid`. */
  mode?: SearchMode;
  /**
   * Search text. Accepts qualifiers: `tag:design` or `#design`, `type:link`,
   * `is:fav`, `is:archived`, `site:github.com`, `folder:"Reading list"`,
   * `price:<100` (also `>`, `<=`, `>=` and `=`) and `"quoted phrases"`.
   */
  query?: string;
  /** Required with `sort: "shuffle"`: the same seed gives the same order. */
  shuffleSeed?: number;
  sort?: CardSort;
  style?: string | readonly string[];
  tag?: string;
  trashed?: boolean;
  type?: CardType | string | readonly (CardType | string)[];
}) => {
  const search = new URLSearchParams();
  if (input.query?.trim()) {
    search.set("q", input.query.trim());
  }
  for (const name of ["type", "style", "hue", "hex"] as const) {
    for (const value of asList(input[name])) {
      if (value.trim()) {
        search.append(name, value.trim());
      }
    }
  }
  if (input.tag?.trim()) {
    search.set("tag", input.tag.trim());
  }
  if (input.folder?.trim()) {
    search.set("folder", input.folder.trim());
  }
  if (input.cursor?.trim()) {
    search.set("cursor", input.cursor.trim());
  }
  if (input.include?.trim()) {
    search.set("include", input.include.trim());
  }
  if (input.favorited) {
    search.set("favorited", "true");
  }
  if (input.trashed) {
    search.set("trashed", "true");
  }
  if (input.archived === "only" || input.archived === "include") {
    search.set("archived", input.archived);
  }
  if (input.mode === "keyword" || input.mode === "semantic") {
    search.set("mode", input.mode);
  }
  if (input.sort === "oldest" || input.sort === "shuffle") {
    search.set("sort", input.sort);
  }
  if (input.sort === "shuffle" && typeof input.shuffleSeed === "number") {
    search.set("shuffleSeed", String(input.shuffleSeed));
  }
  if (typeof input.createdAfter === "number") {
    search.set("createdAfter", String(input.createdAfter));
  }
  if (typeof input.createdBefore === "number") {
    search.set("createdBefore", String(input.createdBefore));
  }
  search.set("limit", String(normalizeLimit(input.limit)));
  return search.toString();
};

const parseJson = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TeakApiError("PARSE_ERROR", "Teak returned malformed JSON.", {
      status: response.status,
    });
  }
};

const asCard = (value: unknown): Card => {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.content !== "string"
  ) {
    throw new TeakApiError(
      "PARSE_ERROR",
      "Teak returned an unexpected card payload."
    );
  }
  return value as unknown as Card;
};
const asPage = (value: unknown): CardsPage => {
  if (
    !(isObject(value) && Array.isArray(value.items) && isObject(value.pageInfo))
  ) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return value as unknown as CardsPage;
};
const asFolder = (value: unknown): Folder => {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string"
  ) {
    throw new TeakApiError(
      "PARSE_ERROR",
      "Teak returned an unexpected folder payload."
    );
  }
  return value as unknown as Folder;
};
const asFolders = (value: unknown): { items: Folder[] } => {
  if (!(isObject(value) && Array.isArray(value.items))) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return { items: value.items.map(asFolder) };
};
const asFolderCards = (value: unknown): FolderCardsResult => {
  if (
    !(
      isObject(value) &&
      isStringArray(value.updatedIds) &&
      isStringArray(value.failedIds)
    )
  ) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return {
    updatedIds: value.updatedIds,
    failedIds: value.failedIds,
    folderLimitIds: isStringArray(value.folderLimitIds)
      ? value.folderLimitIds
      : [],
  };
};
const asTagOperation = (value: unknown): TagOperation => {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.status !== "string"
  ) {
    throw new TeakApiError(
      "PARSE_ERROR",
      "Teak returned an unexpected tag operation payload."
    );
  }
  const { operationId: _operationId, ...operation } = value;
  return operation as unknown as TagOperation;
};
const asTags = (value: unknown): { items: TagSummary[] } => {
  if (!(isObject(value) && Array.isArray(value.items))) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return {
    items: value.items.filter(isObject).map((tag) => ({
      count: Number(tag.count) || 0,
      name: String(tag.name || ""),
    })),
  };
};
const asCreate = (value: unknown): CreateCardResponse => {
  if (
    !isObject(value) ||
    typeof value.cardId !== "string" ||
    value.status !== "created"
  ) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return value as unknown as CreateCardResponse;
};
const asRefresh = (value: unknown): RefreshCardResponse => {
  if (
    !isObject(value) ||
    typeof value.cardId !== "string" ||
    value.status !== "queued"
  ) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return value as unknown as RefreshCardResponse;
};
const asCardContent = (value: unknown): CardContent => {
  if (
    !isObject(value) ||
    typeof value.cardId !== "string" ||
    typeof value.text !== "string" ||
    typeof value.charCount !== "number" ||
    typeof value.truncated !== "boolean" ||
    !["document", "transcript", "content"].includes(String(value.kind))
  ) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return value as unknown as CardContent;
};
const asMe = (value: unknown): Me => {
  if (
    !(isObject(value) && isObject(value.data)) ||
    typeof value.data.id !== "string"
  ) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return value.data as unknown as Me;
};
const asLatestExport = (value: unknown): LatestExport => {
  if (!isObject(value) || typeof value.canStartNew !== "boolean") {
    throw new TeakApiError("PARSE_ERROR");
  }
  return value as unknown as LatestExport;
};
const asUpload = (value: unknown): CreateUploadResponse => {
  if (
    !isObject(value) ||
    typeof value.uploadUrl !== "string" ||
    typeof value.fileKey !== "string" ||
    value.method !== "PUT" ||
    typeof value.maxFileSize !== "number" ||
    typeof value.expiresIn !== "number"
  ) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return value as unknown as CreateUploadResponse;
};

const withoutTrailingSlashes = (value: string) => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
};

export const createTeakClient = (options: {
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  tokenProvider: TokenProvider;
  userAgent?: string;
}) => {
  const baseUrl = withoutTrailingSlashes(
    options.baseUrl || "https://teakvault.com/api"
  );
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const request = async <T>(
    path: string,
    init: RequestInit,
    parser: (payload: unknown) => T,
    retry = true,
    accessToken?: string
  ): Promise<T> => {
    const token = accessToken ?? (await options.tokenProvider.getAccessToken());
    if (!token) {
      throw new TeakApiError("AUTH_REQUIRED");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("User-Agent", options.userAgent || "teak-cli");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      throw new TeakApiError(
        error instanceof DOMException && error.name === "AbortError"
          ? "TIMEOUT"
          : "NETWORK_ERROR"
      );
    } finally {
      clearTimeout(timeout);
    }
    if (
      response.status === 401 &&
      retry &&
      options.tokenProvider.onUnauthorized
    ) {
      const next = await options.tokenProvider.onUnauthorized(token);
      if (next) {
        return request(path, init, parser, false, next);
      }
    }
    const payload = await parseJson(response);
    if (!response.ok) {
      const object = isObject(payload) ? payload : {};
      throw new TeakApiError(
        codeFrom(
          object.code,
          response.status === 404 ? "NOT_FOUND" : "REQUEST_FAILED"
        ),
        String(object.error || response.statusText),
        {
          requestId: response.headers.get("x-request-id") ?? undefined,
          retryAt:
            typeof object.retryAt === "number" ? object.retryAt : undefined,
          status: response.status,
        }
      );
    }
    return parser(payload);
  };
  const qs = (params: Parameters<typeof buildCardsSearchParams>[0]) =>
    buildCardsSearchParams(params);
  const idempotency = (requestOptions?: RequestOptions): HeadersInit =>
    requestOptions?.idempotencyKey
      ? { "Idempotency-Key": requestOptions.idempotencyKey }
      : {};
  const cardPath = (id: string) => `/v1/cards/${encodeURIComponent(id)}`;
  const folderPath = (id: string) => `/v1/folders/${encodeURIComponent(id)}`;
  return {
    cards: {
      bulk: (
        operation: BulkCardsOperation,
        items: unknown[],
        requestOptions?: RequestOptions
      ) =>
        request(
          "/v1/cards/bulk",
          {
            body: JSON.stringify({ items, operation }),
            headers: idempotency(requestOptions),
            method: "POST",
          },
          (v) => v as BulkCardsResponse
        ),
      changes: (input: { cursor?: string; limit?: number; since: number }) => {
        const search = new URLSearchParams(qs(input));
        search.set("since", String(input.since));
        return request(
          `/v1/cards/changes?${search.toString()}`,
          { method: "GET" },
          (v) => v as CardChangesResponse
        );
      },
      create: (input: CreateCardInput, requestOptions?: RequestOptions) =>
        request(
          "/v1/cards",
          {
            body: JSON.stringify(input),
            headers: idempotency(requestOptions),
            method: "POST",
          },
          asCreate
        ),
      /**
       * The card's full stored text: document text, transcript, or a text
       * card's content. Throws NO_CONTENT when the card has none.
       */
      content: (id: string) =>
        request(`${cardPath(id)}/content`, { method: "GET" }, asCardContent),
      /** Moves the card to Trash, or deletes it for good with `permanent`. */
      delete: (id: string, deleteOptions?: { permanent?: boolean }) =>
        request(
          `${cardPath(id)}${deleteOptions?.permanent ? "?permanent=true" : ""}`,
          { method: "DELETE" },
          () => null
        ),
      /** The ID of a saved card with exactly this URL, or null. */
      duplicate: (url: string) =>
        request(
          `/v1/cards/duplicate?${new URLSearchParams({ url }).toString()}`,
          { method: "GET" },
          (v) => (isObject(v) && typeof v.cardId === "string" ? v.cardId : null)
        ),
      favorites: (input: Parameters<typeof qs>[0] = {}) =>
        request(
          `/v1/cards?${qs({ include: "content,metadata", ...input, favorited: true })}`,
          { method: "GET" },
          asPage
        ),
      get: (id: string) => request(cardPath(id), { method: "GET" }, asCard),
      list: (input: Parameters<typeof qs>[0] = {}) =>
        request(`/v1/cards?${qs(input)}`, { method: "GET" }, asPage),
      /** Refreshes summary, tags and link preview; it finishes in the background. */
      refresh: (id: string) =>
        request(`${cardPath(id)}/refresh`, { method: "POST" }, asRefresh),
      restore: (id: string) =>
        request(`${cardPath(id)}/restore`, { method: "POST" }, () => null),
      search: (input: Parameters<typeof qs>[0] = {}) =>
        request(
          `/v1/cards?${qs({ include: "content,metadata", ...input })}`,
          { method: "GET" },
          asPage
        ),
      /** Archives the card (hidden from the library, not deleted) or returns it. */
      setArchived: (id: string, isArchived: boolean) =>
        request(
          cardPath(id),
          { body: JSON.stringify({ isArchived }), method: "PATCH" },
          asCard
        ),
      setFavorite: (id: string, isFavorited: boolean) =>
        request(
          `${cardPath(id)}/favorite`,
          { body: JSON.stringify({ isFavorited }), method: "PATCH" },
          asCard
        ),
      update: (id: string, input: UpdateCardInput) =>
        request(
          cardPath(id),
          { body: JSON.stringify(input), method: "PATCH" },
          asCard
        ),
    },
    exports: {
      latest: () =>
        request("/v1/exports/latest", { method: "GET" }, asLatestExport),
      start: () =>
        request(
          "/v1/exports",
          { method: "POST" },
          (v) => (v as { job: ExportJob }).job
        ),
    },
    folders: {
      /**
       * Adds up to 100 cards; cards already in the folder are left as they
       * are. A smart folder refuses cards (409 SMART_FOLDER).
       */
      addCards: (id: string, cardIds: string[]) =>
        request(
          `${folderPath(id)}/cards`,
          { body: JSON.stringify({ cardIds }), method: "POST" },
          asFolderCards
        ),
      /**
       * Creates a folder; `{ kind: "smart", query }` saves a search, whose
       * cards are whatever matches it when listed.
       */
      create: (
        input:
          | { color?: FolderColor; kind?: "manual"; name: string }
          | { color?: FolderColor; kind: "smart"; name: string; query: string }
      ) =>
        request(
          "/v1/folders",
          { body: JSON.stringify(input), method: "POST" },
          asFolder
        ),
      /** Deletes the folder; its cards are kept. */
      delete: (id: string) =>
        request(folderPath(id), { method: "DELETE" }, () => null),
      get: (id: string) => request(folderPath(id), { method: "GET" }, asFolder),
      /** Every folder, sorted by name. */
      list: () => request("/v1/folders", { method: "GET" }, asFolders),
      removeCards: (id: string, cardIds: string[]) =>
        request(
          `${folderPath(id)}/cards`,
          { body: JSON.stringify({ cardIds }), method: "DELETE" },
          asFolderCards
        ),
      /**
       * Renames or recolors; `color: null` clears the color. `query` changes
       * a smart folder's search.
       */
      update: (
        id: string,
        input: { color?: FolderColor | null; name?: string; query?: string }
      ) =>
        request(
          folderPath(id),
          { body: JSON.stringify(input), method: "PATCH" },
          asFolder
        ),
    },
    me: () => request("/v1/me", { method: "GET" }, asMe),
    tags: {
      /**
       * Deletes a tag from every card, including cards in Trash and Archive.
       * It finishes in the background; poll with `operation`.
       */
      delete: (tag: string) =>
        request(
          "/v1/tags/delete",
          { body: JSON.stringify({ tag }), method: "POST" },
          asTagOperation
        ),
      list: () => request("/v1/tags", { method: "GET" }, asTags),
      /** Replaces `from` with `into` on every card; it finishes in the background. */
      merge: (from: string, into: string) =>
        request(
          "/v1/tags/merge",
          { body: JSON.stringify({ from, into }), method: "POST" },
          asTagOperation
        ),
      /** A tag change's progress. */
      operation: (id: string) =>
        request(
          `/v1/tags/operations/${encodeURIComponent(id)}`,
          { method: "GET" },
          asTagOperation
        ),
      /** Renames a tag on every card; it finishes in the background. */
      rename: (from: string, to: string) =>
        request(
          "/v1/tags/rename",
          { body: JSON.stringify({ from, to }), method: "POST" },
          asTagOperation
        ),
    },
    uploads: {
      create: (input: CreateUploadInput) =>
        request(
          "/v1/uploads",
          { body: JSON.stringify(input), method: "POST" },
          asUpload
        ),
      putFile: async (uploadUrl: string, bytes: BodyInit, mimeType: string) => {
        const headers = new Headers({ "Content-Type": mimeType });
        const byteLength = byteLengthForBody(bytes);
        if (byteLength !== null) {
          headers.set("Content-Length", String(byteLength));
        }
        const response = await fetchImpl(uploadUrl, {
          body: bytes,
          headers,
          method: "PUT",
        });
        if (!response.ok) {
          throw new TeakApiError(
            "REQUEST_FAILED",
            `Upload failed with status ${response.status}`,
            { status: response.status }
          );
        }
        return { fileEtag: response.headers.get("etag") ?? undefined };
      },
    },
  };
};

export type TeakClient = ReturnType<typeof createTeakClient>;

export const parseTags = (value: string | undefined): string[] | undefined =>
  value === undefined
    ? undefined
    : Array.from(
        new Set(
          value
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        )
      );
export const isCardType = (value: string): value is CardType =>
  (CARD_TYPES as readonly string[]).includes(value);
export const isStringList = isStringArray;
