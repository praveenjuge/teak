/**
 * Shared HTTP primitives for the public API: response builders, rate-limit
 * errors, query/body parsers, and the request/response types every public
 * API module uses. Pure leaf — no Convex ctx, safe to import anywhere.
 * Split out of `publicApiHttp.ts`, kept behavior-identical.
 */
import { ConvexError } from "convex/values";
import { json } from "./publicApiMeta";
import { MAX_CARD_TITLE_LENGTH } from "./shared/cardTitle";
import { extractPaletteColors } from "./shared/utils/colorUtils";

export { json } from "./publicApiMeta";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_QUERY_SCAN = 400;
const MAX_BULK_ITEMS = 100;

const CARD_TYPES = new Set([
  "text",
  "link",
  "image",
  "video",
  "audio",
  "document",
  "palette",
  "quote",
]);
const CARD_SORTS = new Set(["newest", "oldest", "shuffle"]);
const ARCHIVED_FILTERS = new Set(["exclude", "only", "include"]);
// Same per-tag cap as data import.
const MAX_TAG_LENGTH = 64;
const FILE_CARD_TYPES = new Set(["image", "video", "audio", "document"]);

/**
 * Every `code` an error response can carry, including the ones the card
 * mutations raise and the API passes through (the SDK must know each one:
 * scripts/public-parity.test.ts checks).
 */
export const PUBLIC_API_ERROR_CODES = [
  "BAD_REQUEST",
  "CARD_LIMIT_REACHED",
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
  "NOT_FOUND",
  "NO_CONTENT",
  "NOT_IN_TRASH",
  "TAG_EXISTS",
  "TAG_OPERATION_RUNNING",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "SMART_FOLDER",
  "TYPE_MISMATCH",
  "UNAUTHORIZED",
  "UNSUPPORTED_TYPE",
] as const;

type ErrorCode = (typeof PUBLIC_API_ERROR_CODES)[number];

interface AuthorizedUser {
  access: "full_access";
  keyId: string;
  rateLimitKey: string;
  source: "component" | "oauth";
  userId: import("./securitySessions").TeakUserId;
}

type AuthResult = { validated: AuthorizedUser } | { error: Response };
interface CardsQueryOptions {
  /** Archived cards outside Trash; omitted means `"exclude"`. */
  archived?: "exclude" | "only" | "include";
  createdAfter?: number;
  createdBefore?: number;
  cursor?: string;
  favoritesOnly: boolean;
  /** A folder id from `?folder=`; the handler checks it is the user's. */
  folder?: string;
  hexFilters?: string[];
  hueFilters?: string[];
  limit: number;
  /** Qualifiers in `q` that contradict the other parameters. */
  matchesNothing?: boolean;
  /** Qualifiers from `q` beyond what the plain parameters carry. */
  qualifiers?: {
    archivedInTrash?: boolean;
    folderNames?: string[];
    phrases?: string[];
    sites?: string[];
    tags?: string[];
  };
  searchQuery?: string;
  showTrashOnly?: boolean;
  /** Shuffle's seed; required with `sort=shuffle`. */
  shuffleSeed?: number;
  sort?: "newest" | "oldest" | "shuffle";
  styleFilters?: string[];
  tag?: string;
  type?: string;
  types?: string[];
}
interface CreateCardPayload {
  cardType?: string;
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
interface CreateUploadPayload {
  fileName: string;
  fileSize: number;
  mimeType: string;
}
type QueryValue = boolean | number | string | readonly string[] | undefined;
export interface PublicApiOperation {
  body?: unknown;
  headers?: HeadersInit;
  method: "DELETE" | "GET" | "PATCH" | "POST";
  origin?: string;
  path: string;
  query?: Record<string, QueryValue>;
}

type CardListInclude = "content" | "metadata" | "processing";

const errorResponse = (
  status: number,
  code: ErrorCode,
  error: string,
  extras?: Record<string, unknown>,
  headers?: HeadersInit
): Response => json(status, { code, error, ...(extras ?? {}) }, headers);

// RateLimit-Reset and Retry-After are delta-seconds, per the IETF RateLimit
// header fields draft. RateLimit-Limit is sent only when the limit is known.
const buildRateLimitHeaders = (
  retryAt?: number,
  limit?: number
): HeadersInit | undefined => {
  if (!(typeof retryAt === "number" && Number.isFinite(retryAt))) {
    return;
  }

  const retryAfterSeconds = String(
    Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))
  );
  return {
    ...(typeof limit === "number" && Number.isFinite(limit)
      ? { "RateLimit-Limit": String(limit) }
      : {}),
    "RateLimit-Remaining": "0",
    "RateLimit-Reset": retryAfterSeconds,
    "Retry-After": retryAfterSeconds,
  };
};

const parseBearerToken = (request: Request): string | null => {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (!(scheme && token) || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim();
};

const parseLimit = (raw: string | null): number => {
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_LIMIT;
  }

  // Number() parses the complete value: partial numerics such as "10junk"
  // or "1e2" must fall back to the default instead of being truncated the
  // way parseInt would.
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(parsed, MAX_LIMIT));
};

const parseJsonBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Invalid JSON body",
    });
  }
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return toHex(new Uint8Array(digest));
};

const errorMessageOf = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
};

const OCC_FAILURE_TEXT =
  "changed while this mutation was being run and on every subsequent retry";

/** A mutation that kept losing optimistic-concurrency races on any table. */
const isOptimisticConcurrencyError = (error: unknown): boolean =>
  errorMessageOf(error)?.includes(OCC_FAILURE_TEXT) ?? false;

const isRateLimitContentionError = (error: unknown): boolean => {
  const message = errorMessageOf(error);
  return Boolean(
    message?.includes('"rateLimits" table') &&
      message.includes(OCC_FAILURE_TEXT)
  );
};

const RATE_LIMITED_ERROR = (retryAt?: number, limit?: number): Response =>
  errorResponse(
    429,
    "RATE_LIMITED",
    "Too many requests",
    { retryAt },
    buildRateLimitHeaders(retryAt, limit)
  );

// Busy backend state, not a client error: safe to retry after a second.
const SERVICE_BUSY_ERROR = (): Response =>
  errorResponse(
    503,
    "SERVICE_UNAVAILABLE",
    "The service is busy. Retry the request.",
    undefined,
    { "Retry-After": "1" }
  );

const RATE_LIMIT_CONTENTION_ERROR = (): Response => {
  const retryAt = Date.now() + 1000;
  console.warn("[rate-limit] Contention fallback", {
    event: "rate_limit_contention_fallback",
    retryAt,
  });
  return errorResponse(
    429,
    "RATE_LIMITED",
    "Too many requests",
    { retryAt },
    buildRateLimitHeaders(retryAt)
  );
};

const AUTH_INTERNAL_ERROR = (): Response =>
  errorResponse(500, "INTERNAL_ERROR", "Failed to authorize request");

// Backend error codes that are not plain bad requests.
const CONVEX_ERROR_STATUS: Partial<Record<string, number>> = {
  CONFLICT: 409,
  FOLDER_LIMIT: 409,
  LIMIT_REACHED: 409,
  NOT_FOUND: 404,
  NOT_IN_TRASH: 409,
  SMART_FOLDER: 409,
  TAG_EXISTS: 409,
  TAG_OPERATION_RUNNING: 409,
};

const mapConvexErrorToResponse = (
  error: unknown,
  fallbackMessage: string
): Response => {
  if (error instanceof ConvexError) {
    const payload = (error.data ?? {}) as {
      code?: unknown;
      limit?: unknown;
      message?: unknown;
      retryAt?: unknown;
    };

    const code =
      typeof payload.code === "string"
        ? (payload.code as ErrorCode)
        : "BAD_REQUEST";
    const message =
      typeof payload.message === "string" ? payload.message : fallbackMessage;

    if (code === "RATE_LIMITED") {
      const retryAt =
        typeof payload.retryAt === "number" && Number.isFinite(payload.retryAt)
          ? payload.retryAt
          : undefined;
      return errorResponse(
        429,
        code,
        message,
        retryAt ? { retryAt } : undefined,
        buildRateLimitHeaders(
          retryAt,
          typeof payload.limit === "number" ? payload.limit : undefined
        )
      );
    }

    return json(CONVEX_ERROR_STATUS[code] ?? 400, {
      code,
      error: message,
    });
  }

  if (isRateLimitContentionError(error)) {
    return RATE_LIMIT_CONTENTION_ERROR();
  }
  if (isOptimisticConcurrencyError(error)) {
    return SERVICE_BUSY_ERROR();
  }

  return errorResponse(500, "INTERNAL_ERROR", fallbackMessage);
};

/**
 * Trims a title and cuts it to the maximum title length instead of rejecting
 * it. Non-string values pass through for the caller's own validation.
 */
const truncateCardTitle = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  let title = value.trim();
  if (title.length > MAX_CARD_TITLE_LENGTH) {
    title = title.slice(0, MAX_CARD_TITLE_LENGTH);
    // Never leave half of a surrogate pair at the cut.
    if (/[\uD800-\uDBFF]$/.test(title)) {
      title = title.slice(0, -1);
    }
    title = title.trimEnd();
  }
  return title;
};

/** Returns why a tag list is invalid, or null when every tag fits. */
const explainInvalidTags = (tags: readonly string[] | undefined) => {
  const tooLong = tags?.find((tag) => tag.trim().length > MAX_TAG_LENGTH);
  return tooLong === undefined
    ? null
    : `Each tag must be at most ${MAX_TAG_LENGTH} characters`;
};

/**
 * Returns why an explicit card type cannot describe a card created without an
 * uploaded file, or null when it can. File types need an upload, and a
 * palette needs at least one color Teak can read.
 */
const explainCardTypeMismatch = (args: {
  cardType?: string;
  content?: string;
  notes?: string | null;
  tags?: readonly string[];
}): string | null => {
  if (!args.cardType) {
    return null;
  }
  if (FILE_CARD_TYPES.has(args.cardType)) {
    return `\`cardType\` \`${args.cardType}\` needs an uploaded file. Upload it with POST /v1/uploads first.`;
  }
  if (args.cardType === "palette") {
    const paletteText = [args.content, args.notes, args.tags?.join(" ")]
      .filter(Boolean)
      .join("\n");
    if (extractPaletteColors(paletteText, 1).length === 0) {
      return "A `palette` card needs at least one color, such as #ff5500";
    }
  }
  return null;
};

const parseOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const parseOptionalNullableString = (
  value: unknown
): string | null | undefined => {
  if (value === null) {
    return null;
  }

  return parseOptionalString(value);
};

const parseStringArray = (value: unknown): string[] | undefined => {
  if (
    !(Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  ) {
    return;
  }

  const normalized = Array.from(
    new Set(value.map((entry) => entry.trim()).filter(Boolean))
  );

  return normalized.length > 0 ? normalized : [];
};

const parseBooleanQuery = (value: string | null): boolean | undefined => {
  if (!value) {
    return;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }
};

const parseTimestampQuery = (value: string | null): number | undefined => {
  if (!value) {
    return;
  }

  if (value.trim().length === 0) {
    return Number.NaN;
  }

  // Number() parses the complete value so partial numerics such as
  // "10junk" fail validation instead of being truncated by parseInt.
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export {
  ARCHIVED_FILTERS,
  AUTH_INTERNAL_ERROR,
  type AuthorizedUser,
  type AuthResult,
  buildRateLimitHeaders,
  CARD_SORTS,
  CARD_TYPES,
  type CardListInclude,
  type CardsQueryOptions,
  type CreateCardPayload,
  type CreateUploadPayload,
  DEFAULT_LIMIT,
  type ErrorCode,
  errorResponse,
  explainCardTypeMismatch,
  explainInvalidTags,
  isOptimisticConcurrencyError,
  isRateLimitContentionError,
  MAX_BULK_ITEMS,
  MAX_LIMIT,
  MAX_QUERY_SCAN,
  MAX_TAG_LENGTH,
  mapConvexErrorToResponse,
  parseBearerToken,
  parseBooleanQuery,
  parseJsonBody,
  parseLimit,
  parseOptionalNullableString,
  parseOptionalString,
  parseStringArray,
  parseTimestampQuery,
  type QueryValue,
  RATE_LIMIT_CONTENTION_ERROR,
  RATE_LIMITED_ERROR,
  SERVICE_BUSY_ERROR,
  sha256,
  truncateCardTitle,
};
