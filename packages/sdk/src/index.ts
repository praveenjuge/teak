export { formatBytes } from "@teak/convex/shared/utils/formatBytes";
export {
  type AuthDiscovery,
  discoverAuthServer,
  type OAuthSurface,
  validateOAuthUrl,
} from "./authDiscovery";
export {
  ACCESS_TOKEN_REFRESH_MARGIN_MS,
  type CredentialBinding,
  createOAuthSession,
  isRefreshTokenDead,
  isWorkosCredential,
  matchesBinding,
  type OAuthAuthorize,
  type OAuthCredentialStore,
  type OAuthCredentials,
  type OAuthFailure,
  type OAuthSession,
  OAuthSessionError,
  type OAuthSessionOptions,
  type OAuthSignOutResult,
  refreshAndSave,
} from "./oauthSession";
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

import { type CardType, cardTypes } from "@teak/convex/shared/constants";
import {
  type FileKind,
  type FilePreviewFacts,
  inferFileFormat,
  isGenericMimeType,
  MAX_FILE_SIZE,
  mimeTypeForFileName,
  validateFileName,
} from "@teak/convex/shared/fileFormats";

import type { FOLDER_COLORS } from "@teak/convex/shared/folders";
import {
  type CARD_CONTENT_KINDS,
  CARD_LIST_PARAM_NAMES,
  CARD_LIST_PARAMS,
  type CardListParam,
  type CardListParamSpec,
  type ArchivedFilter as ContractArchivedFilter,
  type BulkCardOperation as ContractBulkCardOperation,
  type SearchMode as ContractSearchMode,
  PUBLIC_API_CARD_SORTS,
  PUBLIC_API_DEFAULT_LIMIT,
  PUBLIC_API_MAX_LIMIT,
  type PublicApiOperationId,
  publicApiOperationSpec,
  publicApiPath,
  publicApiPathParams,
} from "@teak/convex/shared/publicApiContract";
import { TAG_OPERATION_STALL_MS } from "@teak/convex/shared/tags";
import { errorFromResponse, isObject, TeakApiError } from "./errors";
import { type WaitOptions, waitFor } from "./waitFor";

export type { CardType } from "@teak/convex/shared/constants";
export {
  CARD_LIST_PARAMS,
  type CardListParam,
  type CardListParamSpec,
  SEARCH_QUERY_HELP,
} from "@teak/convex/shared/publicApiContract";
export {
  AUTH_ERROR_CODES,
  ERROR_CODES,
  errorKindFor,
  TeakApiError,
  type TeakApiErrorCode,
  type TeakErrorKind,
  teakErrorKind,
} from "./errors";
export {
  DEFAULT_WAIT_TIMEOUT_MS,
  type WaitOptions,
  waitFor,
} from "./waitFor";

export const CARD_TYPES = cardTypes;
export const CARD_SORTS = PUBLIC_API_CARD_SORTS;
export type CardSort = (typeof CARD_SORTS)[number];
/**
 * How a search finds cards: `hybrid` (the API's default) matches words and
 * meaning, `keyword` words only, `semantic` meaning only.
 */
export type SearchMode = ContractSearchMode;
export type FetchLike = typeof fetch;
export interface TokenProvider {
  getAccessToken: () => Promise<string | null> | string | null;
  onUnauthorized?: (
    rejectedToken: string
  ) => Promise<string | null> | string | null;
}

/** A link's saved copy of its page. The HTML itself stays in Teak. */
export interface CardArchive {
  bytes: number;
  capturedAt: number;
  kind: "full" | "text_only";
}

/** A link's article, from its saved copy; read it with `cards.content(id, { kind: "article" })`. */
export interface CardArticle {
  readingMinutes: number;
  wordCount: number;
}

export interface Card {
  aiSummary: string | null;
  aiTags: string[];
  aiTranscript: string | null;
  appUrl: string;
  /**
   * A link's saved copy of its page: `full`, or `text_only` when the page
   * was too large; null until it is saved and for other cards. Servers that
   * predate saved copies leave it out.
   */
  archive?: CardArchive | null;
  /** When the card was archived, or null. */
  archivedAt: number | null;
  /** A link's article; null when it has none or it isn't ready. */
  article?: CardArticle | null;
  /** Bar heights 0-100: 45 for a grid card, 200 for a player. */
  audioWaveform: { detail: number[]; grid: number[] } | null;
  /** Your cards that link to this one, most recently updated first. */
  backlinks?: CardLinkRef[];
  backlinksTruncated?: boolean;
  colors: Array<{ hex: string; name?: string }>;
  compactUrl: string | null;
  /**
   * When the link was marked read, watched, bought or done, or null.
   * Servers that predate done states leave it out.
   */
  completedAt?: number | null;
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
  /**
   * Passages highlighted in a link's article; 0 for other cards. Servers
   * that predate highlights leave it out.
   */
  highlightCount?: number;
  id: string;
  /** Archived cards are hidden from the library but still count. */
  isArchived: boolean;
  isDeleted: boolean;
  isFavorited: boolean;
  /**
   * Tagged `secret` or `hidden`: left out of lists and searches unless the
   * search names one of those tags (`#secret`). Servers that
   * predate hidden cards leave it out.
   */
  isHidden?: boolean;
  /**
   * Pinned to the top of the library. Servers that predate pinning leave
   * it out.
   */
  isPinned?: boolean;
  linkAuthor: string | null;
  /**
   * What a link is (`article`, `movie`, `product`…), or null. A plain
   * string: new categories are added over time.
   */
  linkCategory?: string | null;
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
  /**
   * Cards this card links to with `[[Title|teak:<id>]]`, in order. Only on
   * single-card responses (`cards.get`, update, favorite, done, create).
   */
  links?: CardLinkRef[];
  linksTruncated?: boolean;
  metadataDescription: string | null;
  metadataStatus: string | null;
  metadataTitle: string | null;
  mimeType: string | null;
  notes: string | null;
  placeholderUrl: string | null;
  processingStatus: Record<string, unknown> | null;
  /**
   * When the card was last saved: `createdAt`, or later when the same link
   * was saved again. Lists order by it. Servers that predate it leave it out.
   */
  savedAt?: number;
  screenshotUrl: string | null;
  /**
   * The title of the page in `sourceUrl`. Servers that predate sources
   * leave it out.
   */
  sourceTitle?: string | null;
  /**
   * The page the card was saved from, such as the page a quote was selected
   * on. Servers that predate sources leave it out.
   */
  sourceUrl?: string | null;
  tags: string[];
  /** True when linkPreviewImageUrl is an image chosen for the link. */
  thumbnailOverridden: boolean;
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
/** A linked card; `missing` when it's in Trash, deleted or not yours. */
export interface CardLinkRef {
  id: string;
  missing: boolean;
  title: string | null;
  type: CardType | string | null;
}
export interface CardLinks {
  backlinks: CardLinkRef[];
  backlinksTruncated: boolean;
  links: CardLinkRef[];
  linksTruncated: boolean;
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
  /** With a query and `sort: "relevance"`: whether the top results were scored. */
  relevanceRanked?: boolean;
  /** With a query: the mode that ran (`keyword` when meaning search could not). */
  searchMode?: SearchMode;
  /**
   * For similar cards: `pending` while the card is still being read, and
   * `unavailable` for a card in Trash or not found.
   */
  similarity?: "ok" | "pending" | "unavailable";
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
  /**
   * The folder's latest rule run, which saving its rules starts. Follow it
   * with `folders.getRuleRun`. Missing from servers older than folder rules.
   */
  ruleRunId?: string | null;
  /** A manual folder's rules; null for a smart folder. */
  rules?: FolderRules | null;
  updatedAt: number;
}
export interface FolderRules {
  /**
   * A search that files matching cards into the folder once their AI tags
   * are written; null when the folder has none.
   */
  autoFile: { enabled: boolean; query: string } | null;
  /** Tags every card that joins the folder gets, however it joins. */
  autoTags: string[];
}
/** Rule fields a manual folder accepts on create and update. */
export interface FolderRulesInput {
  /** False pauses the auto-file search without clearing it. */
  autoFileEnabled?: boolean;
  /** A search without like: or mood:; null clears it. */
  autoFileQuery?: string | null;
  /** Up to 10 tags; an empty list clears them. */
  autoTags?: string[];
}
export type FolderRuleRunStatus =
  | "running"
  | "done"
  | "undoing"
  | "undone"
  | "superseded";
/** A pass of a folder's rules over the library; it can be undone for a day. */
export interface FolderRuleRun {
  canUndo: boolean;
  completedAt: number | null;
  createdAt: number;
  /** Cards the run filed into the folder. */
  filedCount: number;
  folderId: string;
  id: string;
  status: FolderRuleRunStatus;
  /** Cards the run added tags to. */
  taggedCount: number;
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
/** A passage highlighted in a link's article, with an optional note. */
export interface Highlight {
  /** False until the quote is found in the card's saved article. */
  anchored: boolean;
  cardId: string;
  createdAt: number;
  id: string;
  note: string | null;
  quote: string;
  /** `reader`, `api` or `import`; accept values this SDK doesn't know. */
  source: string;
  updatedAt: number;
}

export interface CreateHighlightInput {
  note?: string;
  /** Text just before the quote, to pick one of its repeats. */
  prefix?: string;
  /** Text from the article; whitespace, curly quotes and case needn't match. */
  quote: string;
  /** Text just after the quote, to pick one of its repeats. */
  suffix?: string;
}

export interface FolderCardsResult {
  failedIds: string[];
  /** Failed cards that are already in the most folders a card can be in. */
  folderLimitIds: string[];
  updatedIds: string[];
}
export interface CreateCardInput {
  /**
   * Optional card type: `text`, `link`, `image`, `video`, `audio`,
   * `document`, `palette` or `quote`. Set it to `text` to store raw Markdown
   * exactly; omit it to keep automatic URL, quote, and palette detection.
   * @default inferred
   */
  cardType?: CardType;
  /**
   * Markdown or plain text body for the card. Prefer this for notes; use `url`
   * when saving a link.
   */
  content?: string;
  /** The `ETag` the upload `PUT` returned, for a file card. */
  fileEtag?: string;
  /** The `fileKey` from `uploads.create`, for a file card. */
  fileKey?: string;
  /** The uploaded file's name, for a file card. */
  fileName?: string;
  /** The uploaded file's size in bytes, for a file card. */
  fileSize?: number;
  /** The uploaded file's MIME type, for a file card. */
  mimeType?: string;
  /** Free-form notes attached to the card. */
  notes?: string | null;
  /**
   * The `fileKey` from `pageSnapshots.createUpload`: the page as the browser
   * showed it, which becomes a link's saved copy. Ignored when it isn't one
   * of your snapshot uploads.
   */
  pageSnapshotKey?: string;
  /**
   * A free label for what saved the card (extension, CLI, API, and so on),
   * kept in its metadata. For the page the card came from, use `sourceUrl`.
   */
  source?: string;
  /** The page's title, beside `sourceUrl`; cut to 300 characters. */
  sourceTitle?: string;
  /**
   * The page the card came from, such as the page a quote was selected on:
   * an http or https URL of at most 2,048 characters. Unlike `url`, it never
   * makes the card a link.
   */
  sourceUrl?: string;
  /** Tags to apply on create. */
  tags?: string[];
  /**
   * URL to save as a link card. Teak may classify the type automatically when
   * `cardType` is omitted.
   */
  url?: string;
}
export interface UpdateCardInput {
  /** Palette cards only: hex codes to add, such as `#FF5500`. */
  addColors?: string[];
  content?: string;
  /** Replaces the card's folders; an empty list takes it out of every folder. */
  folderIds?: string[];
  isArchived?: boolean;
  metadataTitle?: string | null;
  notes?: string | null;
  /** AI tags to drop. `tags` replaces only the card's own tags. */
  removeAiTags?: string[];
  /** Palette cards only: hex codes to remove. Removes apply before `addColors`. */
  removeColors?: string[];
  tags?: string[];
  url?: string;
}
export interface Me {
  cardCount: number;
  /** Null on Pro, which has no card limit. */
  cardLimit: number | null;
  email: string;
  id: string;
  /**
   * The account's Teak language, chosen in Settings: a BCP 47 code such as
   * `en`, `de` or `pt-BR`. More may be added, so treat an unknown code as
   * English.
   */
  locale: string;
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
  /** Cancels the request; it rejects with a TIMEOUT `TeakApiError`. */
  signal?: AbortSignal;
}
/** A file upload that finished, kept to create its card again without re-uploading. */
export interface UploadedFile {
  fileEtag?: string;
  fileKey: string;
}
/** A file to save as a card with `cards.createFromFile`. */
export interface CreateCardFromFileInput
  extends Omit<
    CreateCardInput,
    | "fileEtag"
    | "fileKey"
    | "fileName"
    | "fileSize"
    | "mimeType"
    | "pageSnapshotKey"
    | "url"
  > {
  bytes: Blob | ArrayBuffer | ArrayBufferView;
  fileName: string;
  /** Its MIME type; read from a Blob or the file name when left out. */
  mimeType?: string;
  /** Called once the bytes are uploaded, before the card is created. */
  onUploaded?: (uploaded: UploadedFile) => unknown;
  /** An earlier attempt's finished upload: the card is created from it. */
  uploaded?: UploadedFile;
}
export interface CreateUploadInput {
  fileName: string;
  fileSize: number;
  mimeType: string;
}
/** A link image upload: JPEG, PNG, WebP, GIF or AVIF, under 20 MB. */
export interface CreatePageSnapshotUploadInput {
  /** The gzipped page's exact size; at most 20 MiB. */
  bytes: number;
}
export interface CreateThumbnailUploadInput {
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
  /**
   * True when the link was already in Teak: no card was made, and that card
   * (`cardId`) moved to the top. Tags and notes sent with the save were not
   * applied; update the card to add them.
   */
  resaved?: true;
  /** `status` stays `created` for a re-save too. */
  status: "created";
  /** True when the re-saved card was archived; it is back in the library. */
  wasArchived?: true;
}
export interface RefreshCardResponse {
  cardId: string;
  requestedAt: number;
  status: "queued";
}
/** An arXiv link's PDF saved as a document card (POST /v1/cards/:id/save-pdf). */
export interface SavedPdf {
  /** The document card holding the PDF. */
  cardId: string;
  /** False when an earlier save already made that card. */
  created: boolean;
}
/** The kinds of stored text a card can have. */
export type CardContentKind = (typeof CARD_CONTENT_KINDS)[number];

/** A card's full stored text (GET /v1/cards/:id/content). */
export interface CardContent {
  cardId: string;
  /** Characters in the full stored text. */
  charCount: number;
  /**
   * document: extracted from the card's file; transcript: its speech;
   * content: a text or quote card's written text; article: a link's article
   * as Markdown, with image links valid for 7 days. A kind this SDK doesn't
   * know yet comes through as a string rather than an error.
   */
  kind: CardContentKind | (string & {});
  text: string;
  /** The document is longer than Teak keeps. */
  truncated: boolean;
}
export type BulkCardsOperation = ContractBulkCardOperation;
/** One bulk item's outcome; `index` is its place in the items sent. */
export type BulkCardResult =
  | {
      cardId: string;
      index: number;
      /** A create that found the link already saved. */
      resaved?: true;
      status: "success";
      wasArchived?: true;
    }
  | { code: string; error: string; index: number; status: "error" };
export interface BulkCardsResponse {
  /** The `cardId` of every item that failed, to retry just those. */
  failedIds: string[];
  operation: BulkCardsOperation;
  results: BulkCardResult[];
  summary: { failed: number; succeeded: number; total: number };
}
/** Archived cards outside Trash: left out by default. */
export type ArchivedFilter = ContractArchivedFilter;

export const staticTokenProvider = (token: string): TokenProvider => ({
  getAccessToken: () => token,
});

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");
/** A page size the API takes: a whole number from 1 to its maximum. */
export const normalizeLimit = (limit?: number): number => {
  if (!Number.isFinite(limit)) {
    return PUBLIC_API_DEFAULT_LIMIT;
  }
  return Math.max(
    1,
    Math.min(
      Math.trunc(limit ?? PUBLIC_API_DEFAULT_LIMIT),
      PUBLIC_API_MAX_LIMIT
    )
  );
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

/**
 * The filters `cards.list` and its siblings take: the API's card list
 * parameters (`CARD_LIST_PARAMS` in the public contract), with `q` named
 * `query`.
 */
export interface CardListInput {
  archived?: ArchivedFilter;
  createdAfter?: number;
  createdBefore?: number;
  cursor?: string;
  favorited?: boolean;
  /** Only cards in this folder id. */
  folder?: string;
  hex?: string | readonly string[];
  hue?: string | readonly string[];
  /** Comma-separated: `content`, `metadata`, `processing`. */
  include?: string;
  limit?: number;
  /** How `query` finds cards; the API defaults to `hybrid`. */
  mode?: SearchMode;
  /**
   * Only cards pinned to the top of the library. Without `query`, they come
   * back in their pinned order as one page.
   */
  pinned?: boolean;
  /**
   * Search text with qualifiers such as `tag:design`, `type:link`,
   * `is:done`, `site:github.com`, `-tag:old` and `a OR b`;
   * `SEARCH_QUERY_HELP` lists every one.
   */
  query?: string;
  /** Required with `sort: "shuffle"`: the same seed gives the same order. */
  shuffleSeed?: number;
  /** A card id: only the cards closest to it in meaning. */
  similarTo?: string;
  sort?: CardSort;
  style?: string | readonly string[];
  tag?: string;
  trashed?: boolean;
  type?: CardType | string | readonly (CardType | string)[];
}

/** One parameter's values as the query string writes them. */
const paramValues = (
  input: CardListInput,
  param: CardListParam
): readonly string[] => {
  const spec: CardListParamSpec = CARD_LIST_PARAMS[param];
  if (param === "limit") {
    return [String(normalizeLimit(input.limit))];
  }
  // A seed means nothing without the order it seeds.
  if (param === "shuffleSeed" && input.sort !== "shuffle") {
    return [];
  }
  const value: unknown = param === "q" ? input.query : input[param];
  switch (spec.kind) {
    case "boolean":
      return value === true ? ["true"] : [];
    case "integer":
    case "timestamp":
      return typeof value === "number" ? [String(value)] : [];
    default:
      // Text and enums: trimmed, blank ones and the API's default left out.
      return asList(value as string | readonly string[] | undefined)
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "" && entry !== spec.default)
        .slice(0, spec.repeatable ? undefined : 1);
  }
};

export const buildCardsSearchParams = (input: CardListInput) => {
  const search = new URLSearchParams();
  for (const param of CARD_LIST_PARAM_NAMES) {
    for (const value of paramValues(input, param)) {
      search.append(param, value);
    }
  }
  return search.toString();
};

const readStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<string> => {
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    text += decoder.decode(value, { stream: true });
  }
};

/**
 * Reads the body before the request's timeout fires. A fetch that ignores the
 * abort could leave a stalled body pending forever, so the read races it and
 * the timeout cancels the body through the reader that holds its lock.
 */
const readBody = (response: Response, signal: AbortSignal): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = response.body?.getReader();
    const onAbort = () => {
      reject(new TeakApiError("TIMEOUT"));
      reader?.cancel().catch(() => undefined);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    if (!reader) {
      resolve("");
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    readStream(reader)
      .then(resolve, () =>
        reject(new TeakApiError(signal.aborted ? "TIMEOUT" : "NETWORK_ERROR"))
      )
      .finally(() => signal.removeEventListener("abort", onAbort));
  });

const parseJson = (response: Response, text: string): unknown => {
  if (response.status === 204 || !text.trim()) {
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
const asPinnedCards = (value: unknown): CardsPage["items"] => {
  if (!(isObject(value) && Array.isArray(value.items))) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return value.items as CardsPage["items"];
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
const asFolderRuleRun = (value: unknown): FolderRuleRun => {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.status !== "string"
  ) {
    throw new TeakApiError(
      "PARSE_ERROR",
      "Teak returned an unexpected folder rule run payload."
    );
  }
  return value as unknown as FolderRuleRun;
};
const asFolders = (value: unknown): { items: Folder[] } => {
  if (!(isObject(value) && Array.isArray(value.items))) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return { items: value.items.map(asFolder) };
};
const asHighlight = (value: unknown): Highlight => {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.quote !== "string"
  ) {
    throw new TeakApiError(
      "PARSE_ERROR",
      "Teak returned an unexpected highlight payload."
    );
  }
  return value as unknown as Highlight;
};
const asHighlights = (value: unknown): { items: Highlight[] } => {
  if (!(isObject(value) && Array.isArray(value.items))) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return { items: value.items.map(asHighlight) };
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
const asSavedPdf = (value: unknown): SavedPdf => {
  if (
    !isObject(value) ||
    typeof value.cardId !== "string" ||
    typeof value.created !== "boolean"
  ) {
    throw new TeakApiError("PARSE_ERROR");
  }
  return { cardId: value.cardId, created: value.created };
};
const asCardContent = (value: unknown): CardContent => {
  if (
    !isObject(value) ||
    typeof value.cardId !== "string" ||
    typeof value.text !== "string" ||
    typeof value.charCount !== "number" ||
    typeof value.truncated !== "boolean" ||
    typeof value.kind !== "string"
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

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRY_WAIT_MS = 5000;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Reads are always safe to send again, and so is a write that carries an
 * Idempotency-Key: the API answers its replay with the first result.
 */
const canRetry = (init: RequestInit) => {
  const method = (init.method ?? "GET").toUpperCase();
  return (
    method === "GET" ||
    method === "HEAD" ||
    new Headers(init.headers).has("Idempotency-Key")
  );
};

const retryDelay = (error: TeakApiError, attempt: number): number | null => {
  const retryable =
    error.code === "NETWORK_ERROR" ||
    error.code === "IN_PROGRESS" ||
    (error.status !== undefined && RETRY_STATUSES.has(error.status));
  if (!retryable) {
    return null;
  }
  if (error.retryAt !== undefined) {
    const wait = Math.max(0, error.retryAt - Date.now());
    return wait > MAX_RETRY_WAIT_MS ? null : wait;
  }
  return Math.min(MAX_RETRY_WAIT_MS, 250 * 2 ** attempt);
};

export const createTeakClient = (options: {
  baseUrl?: string;
  fetch?: FetchLike;
  /**
   * How many times to send a read (or a write with an idempotency key) again
   * after a busy (429, 502, 503, 504) or unreachable service. Defaults to 2.
   */
  retries?: number;
  timeoutMs?: number;
  tokenProvider: TokenProvider;
  userAgent?: string;
}) => {
  const baseUrl = withoutTrailingSlashes(
    options.baseUrl || "https://teakvault.com/api"
  );
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = Math.max(0, Math.floor(options.retries ?? 2));
  const send = async (
    path: string,
    init: RequestInit,
    token: string
  ): Promise<{ response: Response; text: string }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const caller = init.signal;
    const cancel = () => controller.abort();
    if (caller?.aborted) {
      cancel();
    }
    caller?.addEventListener("abort", cancel, { once: true });
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("User-Agent", options.userAgent || "teak-sdk");
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    try {
      let response: Response;
      try {
        if (controller.signal.aborted) {
          throw new DOMException("The request was cancelled.", "AbortError");
        }
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
      }
      const text =
        response.status === 204
          ? ""
          : await readBody(response, controller.signal);
      return { response, text };
    } finally {
      clearTimeout(timeout);
      caller?.removeEventListener("abort", cancel);
    }
  };
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
    const retriesAllowed = canRetry(init) ? retries : 0;
    const waitBeforeRetry = (error: unknown, attempt: number) =>
      error instanceof TeakApiError && attempt < retriesAllowed
        ? retryDelay(error, attempt)
        : null;
    for (let attempt = 0; ; attempt += 1) {
      let exchange: { response: Response; text: string };
      try {
        exchange = await send(path, init, token);
      } catch (error) {
        const delay = waitBeforeRetry(error, attempt);
        if (delay === null) {
          throw error;
        }
        await sleep(delay);
        continue;
      }
      const { response, text } = exchange;
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
      if (response.ok) {
        return parser(parseJson(response, text));
      }
      const error = errorFromResponse(response, text);
      const delay = waitBeforeRetry(error, attempt);
      if (delay === null) {
        throw error;
      }
      await sleep(delay);
    }
  };
  const qs = (params: CardListInput) => buildCardsSearchParams(params);
  /** Calls an operation by id with its path parameters, query and body. */
  const call = <T>(
    operationId: PublicApiOperationId,
    input: {
      body?: unknown;
      headers?: HeadersInit;
      params?: Record<string, string>;
      query?: string;
      signal?: AbortSignal;
    },
    parser: (payload: unknown) => T
  ): Promise<T> => {
    const missing = publicApiPathParams(operationId).find(
      (name) => !input.params?.[name]
    );
    if (missing) {
      return Promise.reject(
        new TeakApiError("INVALID_INPUT", `${missing} is required.`)
      );
    }
    return request(
      `${publicApiPath(operationId, input.params)}${input.query ? `?${input.query}` : ""}`,
      {
        ...(input.body === undefined
          ? {}
          : { body: JSON.stringify(input.body) }),
        ...(input.headers ? { headers: input.headers } : {}),
        method: publicApiOperationSpec(operationId).method,
        ...(input.signal ? { signal: input.signal } : {}),
      },
      parser
    );
  };
  const card = (cardId: string) => ({ params: { cardId } });
  const idempotency = (requestOptions?: RequestOptions): HeadersInit =>
    requestOptions?.idempotencyKey
      ? { "Idempotency-Key": requestOptions.idempotencyKey }
      : {};
  /** Sends bytes to a signed upload URL; `signal` cancels the upload. */
  const putFile = async (
    uploadUrl: string,
    bytes: BodyInit,
    mimeType: string,
    putOptions?: { signal?: AbortSignal }
  ) => {
    const headers = new Headers({ "Content-Type": mimeType });
    const byteLength = byteLengthForBody(bytes);
    if (byteLength !== null) {
      headers.set("Content-Length", String(byteLength));
    }
    const response = await fetchImpl(uploadUrl, {
      body: bytes,
      headers,
      method: "PUT",
      ...(putOptions?.signal ? { signal: putOptions.signal } : {}),
    }).catch(() => {
      throw new TeakApiError("NETWORK_ERROR");
    });
    if (!response.ok) {
      throw new TeakApiError(
        "REQUEST_FAILED",
        `Upload failed with status ${response.status}`,
        { status: response.status }
      );
    }
    return { fileEtag: response.headers.get("etag") ?? undefined };
  };
  const createThumbnailUpload = (
    id: string,
    input: CreateThumbnailUploadInput
  ) => call("createThumbnailUpload", { ...card(id), body: input }, asUpload);
  const applyThumbnail = (id: string, fileKey: string) =>
    call("setCardThumbnail", { ...card(id), body: { fileKey } }, asCard);
  const createCard = (
    input: CreateCardInput,
    requestOptions?: RequestOptions
  ) =>
    call(
      "createCard",
      { body: input, headers: idempotency(requestOptions) },
      asCreate
    );
  const createUpload = (input: CreateUploadInput) =>
    call("createUpload", { body: input }, asUpload);
  const listCards = (input: CardListInput, requestOptions?: RequestOptions) =>
    call(
      "listCards",
      { query: qs(input), signal: requestOptions?.signal },
      asPage
    );
  const tagOperation = (id: string) =>
    call("getTagOperation", { params: { operationId: id } }, asTagOperation);
  const getRuleRun = (id: string, runId: string) =>
    call(
      "getFolderRuleRun",
      { params: { folderId: id, runId } },
      asFolderRuleRun
    );
  const latestExport = () => call("getLatestExport", {}, asLatestExport);
  const createFromFile = async (
    input: CreateCardFromFileInput,
    requestOptions?: RequestOptions
  ) => {
    const {
      bytes,
      fileName: rawName,
      mimeType: declared,
      onUploaded,
      uploaded: earlier,
      ...fields
    } = input;
    let fileName: string;
    try {
      fileName = validateFileName(rawName);
    } catch (error) {
      throw new TeakApiError(
        "INVALID_INPUT",
        error instanceof Error ? error.message : "Invalid file name."
      );
    }
    const fileSize = byteLengthForBody(bytes as BodyInit) ?? 0;
    if (fileSize < 1 || fileSize > MAX_FILE_SIZE) {
      throw new TeakApiError(
        "FILE_TOO_LARGE",
        `File must be between 1 byte and ${MAX_FILE_SIZE} bytes`
      );
    }
    const typed =
      declared ||
      (typeof Blob !== "undefined" && bytes instanceof Blob
        ? bytes.type
        : "") ||
      mimeTypeForFileName(fileName);
    const format = inferFileFormat({ fileName, mimeType: typed });
    if (!format) {
      throw new TeakApiError("UNSUPPORTED_TYPE", "Unsupported file type");
    }
    const mimeType = isGenericMimeType(typed) ? format.mimeType : typed;
    let uploaded = earlier;
    if (!uploaded) {
      const upload = await createUpload({ fileName, fileSize, mimeType });
      const { fileEtag } = await putFile(
        upload.uploadUrl,
        bytes as BodyInit,
        mimeType
      );
      uploaded = { fileKey: upload.fileKey, ...(fileEtag ? { fileEtag } : {}) };
      await onUploaded?.(uploaded);
    }
    return createCard(
      {
        ...fields,
        cardType: fields.cardType ?? format.cardType,
        fileKey: uploaded.fileKey,
        ...(uploaded.fileEtag ? { fileEtag: uploaded.fileEtag } : {}),
        fileName,
        fileSize,
        mimeType,
      },
      requestOptions
    );
  };
  /**
   * Every page of a listing, first to last, following `nextCursor`. Stop
   * iterating to stop fetching. `list` picks the listing (`cards.search`,
   * `cards.favorites`...); `cards.list` by default.
   */
  async function* pages(
    input: CardListInput = {},
    list: (page: CardListInput) => Promise<CardsPage> = listCards
  ): AsyncGenerator<CardsPage> {
    let cursor = input.cursor;
    for (;;) {
      const page = await list(cursor ? { ...input, cursor } : input);
      yield page;
      if (!page.pageInfo.nextCursor) {
        return;
      }
      cursor = page.pageInfo.nextCursor;
    }
  }
  return {
    cards: {
      bulk: (
        operation: BulkCardsOperation,
        items: unknown[],
        requestOptions?: RequestOptions
      ) =>
        call(
          "bulkCards",
          {
            body: { items, operation },
            headers: idempotency(requestOptions),
          },
          (v) => v as BulkCardsResponse
        ),
      changes: (input: { cursor?: string; limit?: number; since: number }) => {
        const search = new URLSearchParams(qs(input));
        search.set("since", String(input.since));
        return call(
          "listCardChanges",
          { query: search.toString() },
          (v) => v as CardChangesResponse
        );
      },
      create: createCard,
      /**
       * Saves a file as a card: checks it is a type and size Teak takes,
       * uploads it, then creates the card. Pass `uploaded` (from
       * `onUploaded`) to retry only the create.
       */
      createFromFile,
      /**
       * The card's full stored text: document text, transcript, or a text
       * card's content. `{ kind: "article" }` reads a link's article as
       * Markdown; `kind` picks one kind when a card has several. Throws
       * NO_CONTENT when the card has none (of that kind).
       */
      content: (id: string, contentOptions?: { kind?: CardContentKind }) =>
        call(
          "getCardContent",
          {
            ...card(id),
            query: contentOptions?.kind
              ? new URLSearchParams({ kind: contentOptions.kind }).toString()
              : undefined,
          },
          asCardContent
        ),
      /** Moves the card to Trash, or deletes it for good with `permanent`. */
      delete: (id: string, deleteOptions?: { permanent?: boolean }) =>
        call(
          "deleteCard",
          {
            ...card(id),
            query: deleteOptions?.permanent ? "permanent=true" : undefined,
          },
          () => null
        ),
      /** The ID of a saved card with exactly this URL, or null. */
      duplicate: (url: string) =>
        call(
          "findDuplicateCard",
          { query: new URLSearchParams({ url }).toString() },
          (v) => (isObject(v) && typeof v.cardId === "string" ? v.cardId : null)
        ),
      favorites: (input: Parameters<typeof qs>[0] = {}) =>
        call(
          "listCards",
          {
            query: qs({
              include: "content,metadata",
              ...input,
              favorited: true,
            }),
          },
          asPage
        ),
      get: (id: string) => call("getCard", card(id), asCard),
      /**
       * The cards pinned to the top of the library, first to last (at most
       * 12). Takes the `list` filters.
       */
      pinned: (input: Parameters<typeof qs>[0] = {}) =>
        call(
          "listCards",
          {
            query: qs({ include: "content,metadata", ...input, pinned: true }),
          },
          asPage
        ),
      /**
       * Sets the pinned cards' order. List every pinned card's id exactly
       * once, first to last; returns the pinned cards in that order.
       */
      reorderPinned: (cardIds: readonly string[]) =>
        call("reorderPinnedCards", { body: { cardIds } }, asPinnedCards),
      /** Cards this card links to with `[[…]]`, and cards linking to it. */
      links: (id: string) =>
        call("getCard", card(id), (value): CardLinks => {
          const card = asCard(value);
          return {
            backlinks: card.backlinks ?? [],
            backlinksTruncated: card.backlinksTruncated === true,
            links: card.links ?? [],
            linksTruncated: card.linksTruncated === true,
          };
        }),
      list: (input: CardListInput = {}, requestOptions?: RequestOptions) =>
        listCards(input, requestOptions),
      pages,
      /**
       * A signed URL for a link card's new image; `setThumbnail` with bytes
       * does this for you.
       */
      createThumbnailUpload,
      /** Refreshes summary, tags and link preview; it finishes in the background. */
      refresh: (id: string) => call("refreshCard", card(id), asRefresh),
      /**
       * Goes back to the image Teak found for a link card and deletes the one
       * that replaced it. Changes nothing when the card has its own image.
       */
      resetThumbnail: (id: string) =>
        call("resetCardThumbnail", card(id), asCard),
      restore: (id: string) => call("restoreCard", card(id), () => null),
      /** The cards closest in meaning to one card; never the card itself. */
      similar: (id: string, input: Parameters<typeof qs>[0] = {}) =>
        call(
          "listCards",
          {
            query: qs({ include: "content,metadata", ...input, similarTo: id }),
          },
          asPage
        ),
      search: (input: Parameters<typeof qs>[0] = {}) =>
        call(
          "listCards",
          { query: qs({ include: "content,metadata", ...input }) },
          asPage
        ),
      /** Archives the card (hidden from the library, not deleted) or returns it. */
      setArchived: (id: string, isArchived: boolean) =>
        call("updateCard", { ...card(id), body: { isArchived } }, asCard),
      /**
       * Replaces a link card's image: uploads `bytes` (JPEG, PNG, WebP, GIF or
       * AVIF, under 20 MB) and applies them. Pass `{ fileKey }` instead to
       * apply an upload made with `createThumbnailUpload`.
       */
      setThumbnail: async (
        id: string,
        image: BodyInit | { fileKey: string },
        mimeType?: string
      ): Promise<Card> => {
        if (
          isObject(image) &&
          typeof (image as { fileKey?: unknown }).fileKey === "string"
        ) {
          return applyThumbnail(id, (image as { fileKey: string }).fileKey);
        }
        const bytes = image as BodyInit;
        const fileSize = byteLengthForBody(bytes);
        if (fileSize === null || !mimeType) {
          throw new TeakApiError(
            "INVALID_INPUT",
            "setThumbnail needs the image's bytes and its MIME type."
          );
        }
        const upload = await createThumbnailUpload(id, { fileSize, mimeType });
        await putFile(upload.uploadUrl, bytes, mimeType);
        return applyThumbnail(id, upload.fileKey);
      },
      /**
       * Saves an arXiv link's paper as its own document card. Saving the same
       * link again returns that card with `created: false`.
       */
      savePdf: (id: string) => call("saveCardPdf", card(id), asSavedPdf),
      /**
       * Marks a link card read, watched, bought or done (`done: true`), or
       * not; repeating a call changes nothing. Only link cards can be marked.
       */
      setDone: (id: string, done: boolean) =>
        call(done ? "markCardDone" : "unmarkCardDone", card(id), asCard),
      /**
       * Pins a card to the top of the library (a new pin goes first), or
       * unpins it. Pinning past 12 cards fails with `PIN_LIMIT_REACHED`.
       */
      setPinned: (id: string, isPinned: boolean) =>
        call("setCardPinned", { ...card(id), body: { isPinned } }, asCard),
      setFavorite: (id: string, isFavorited: boolean) =>
        call("setCardFavorite", { ...card(id), body: { isFavorited } }, asCard),
      update: (id: string, input: UpdateCardInput) =>
        call("updateCard", { ...card(id), body: input }, asCard),
    },
    exports: {
      latest: latestExport,
      /** Waits for a running export to finish; returns the latest export. */
      waitFor: async (options: WaitOptions<LatestExport> = {}) =>
        waitFor(await latestExport(), {
          ...options,
          refresh: latestExport,
          running: (latest) =>
            latest.job?.status === "pending" ||
            latest.job?.status === "running",
        }),
      start: () =>
        call("startExport", {}, (v) => (v as { job: ExportJob }).job),
    },
    folders: {
      /**
       * Adds up to 100 cards; cards already in the folder are left as they
       * are. A smart folder refuses cards (409 SMART_FOLDER).
       */
      addCards: (id: string, cardIds: string[]) =>
        call(
          "addCardsToFolder",
          { params: { folderId: id }, body: { cardIds } },
          asFolderCards
        ),
      /**
       * Creates a folder; `{ kind: "smart", query }` saves a search, whose
       * cards are whatever matches it when listed.
       */
      create: (
        input:
          | ({
              color?: FolderColor;
              kind?: "manual";
              name: string;
            } & FolderRulesInput)
          | { color?: FolderColor; kind: "smart"; name: string; query: string }
      ) => call("createFolder", { body: input }, asFolder),
      /** Deletes the folder; its cards are kept. */
      delete: (id: string) =>
        call("deleteFolder", { params: { folderId: id } }, () => null),
      get: (id: string) =>
        call("getFolder", { params: { folderId: id } }, asFolder),
      /** How far a rule run has got, and whether it can still be undone. */
      getRuleRun,
      /** Waits for a rule run (or its undo) to finish; returns it. */
      waitForRuleRun: (
        id: string,
        run: FolderRuleRun,
        options: WaitOptions<FolderRuleRun> = {}
      ) =>
        waitFor(run, {
          ...options,
          refresh: (current) => getRuleRun(id, current.id),
          running: (current) =>
            current.status === "running" || current.status === "undoing",
        }),
      /** Every folder, sorted by name. */
      list: () => call("listFolders", {}, asFolders),
      removeCards: (id: string, cardIds: string[]) =>
        call(
          "removeCardsFromFolder",
          { params: { folderId: id }, body: { cardIds } },
          asFolderCards
        ),
      /**
       * Takes back what a rule run did, where it is still there, within a
       * day of the run. The rules stay and won't redo it.
       */
      undoRuleRun: (id: string, runId: string) =>
        call(
          "undoFolderRuleRun",
          { params: { folderId: id, runId } },
          asFolderRuleRun
        ),
      /**
       * Renames or recolors; `color: null` clears the color. `query` changes
       * a smart folder's search. Rule fields change a manual folder's rules;
       * new tags or a new or resumed search start a rule run (`ruleRunId`).
       * 409 RULE_LIMIT past 50 folders with rules.
       */
      update: (
        id: string,
        input: {
          color?: FolderColor | null;
          name?: string;
          query?: string;
        } & FolderRulesInput
      ) =>
        call(
          "updateFolder",
          { params: { folderId: id }, body: input },
          asFolder
        ),
    },
    highlights: {
      /**
       * Highlights a passage of a link's saved article, found by its text:
       * the first match unless `prefix` or `suffix` points at another. An
       * overlapping highlight merges with it. 409 NO_ARTICLE without a saved
       * article, 422 QUOTE_NOT_FOUND, 409 HIGHLIGHT_LIMIT past 200.
       */
      create: (cardId: string, input: CreateHighlightInput) =>
        call("createHighlight", { ...card(cardId), body: input }, asHighlight),
      /** Removes a highlight and its note. */
      delete: (id: string) =>
        call("deleteHighlight", { params: { highlightId: id } }, () => null),
      /** A card's highlights, in the order they appear in its article. */
      list: (cardId: string) =>
        call("listHighlights", card(cardId), asHighlights),
      /** Writes or changes a highlight's note; `note: null` clears it. */
      update: (id: string, input: { note: string | null }) =>
        call(
          "updateHighlight",
          { params: { highlightId: id }, body: input },
          asHighlight
        ),
    },
    me: () => call("getMe", {}, asMe),
    tags: {
      /**
       * Deletes a tag from every card, including cards in Trash and Archive.
       * It finishes in the background; poll with `operation`.
       */
      delete: (tag: string) =>
        call("deleteTag", { body: { tag } }, asTagOperation),
      list: () => call("listTags", {}, asTags),
      /** Replaces `from` with `into` on every card; it finishes in the background. */
      merge: (from: string, into: string) =>
        call("mergeTags", { body: { from, into } }, asTagOperation),
      /** A tag change's progress. */
      operation: tagOperation,
      /**
       * Waits for a tag change to finish. One that made no progress for
       * as long as Teak allows comes back `failed`, as Teak gives up on it.
       */
      waitFor: async (
        operation: TagOperation,
        options: WaitOptions<TagOperation> = {}
      ) => {
        const stalled = (current: TagOperation) =>
          Date.now() - current.updatedAt > TAG_OPERATION_STALL_MS;
        const last = await waitFor(operation, {
          ...options,
          refresh: (current) => tagOperation(current.id),
          running: (current) =>
            current.status === "running" && !stalled(current),
        });
        return last.status === "running"
          ? { ...last, status: "failed" as const }
          : last;
      },
      /** Renames a tag on every card; it finishes in the background. */
      rename: (from: string, to: string) =>
        call("renameTag", { body: { from, to } }, asTagOperation),
    },
    pageSnapshots: {
      /**
       * A signed URL for the page a browser extension saw, gzipped: `PUT`
       * it with `Content-Type: application/gzip`, then pass the `fileKey`
       * to `cards.create` as `pageSnapshotKey`.
       */
      createUpload: (
        input: CreatePageSnapshotUploadInput,
        requestOptions?: RequestOptions
      ) =>
        call(
          "createPageSnapshotUpload",
          { body: input, signal: requestOptions?.signal },
          asUpload
        ),
    },
    uploads: {
      create: createUpload,
      putFile,
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
