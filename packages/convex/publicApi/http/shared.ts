import { ConvexError } from "convex/values";
import { convexFailureKind } from "../../convexFailures";
import type { PublicApiErrorCode } from "../../shared/publicApiContract";
import {
  PUBLIC_API_DEFAULT_LIMIT,
  PUBLIC_API_MAX_LIMIT,
} from "../../shared/publicApiLimits";
import { json } from "./meta";

export {
  PUBLIC_API_MAX_BULK_ITEMS as MAX_BULK_ITEMS,
  PUBLIC_API_MAX_LIMIT as MAX_LIMIT,
} from "../../shared/publicApiLimits";
export { json } from "./meta";

const MAX_QUERY_SCAN = 400;

type ErrorCode = PublicApiErrorCode;

interface AuthorizedUser {
  access: "full_access";
  /** The WorkOS Connect client an OAuth token was issued to. */
  clientId?: string;
  keyId: string;
  rateLimitKey: string;
  source: "component" | "oauth";
  userId: import("../../securitySessions").TeakUserId;
}

type AuthResult = { validated: AuthorizedUser } | { error: Response };
interface CardsQueryOptions {
  archived?: "exclude" | "only" | "include";
  createdAfter?: number;
  createdBefore?: number;
  cursor?: string;
  favoritesOnly: boolean;
  folder?: string;
  hasQuery: boolean;
  hexFilters?: string[];
  hueFilters?: string[];
  limit: number;
  matchesNothing?: boolean;
  mode: import("../../shared/search/semantic").SearchMode;
  /** `pinned=true` or `is:pinned`: only pinned cards. */
  pinnedOnly: boolean;
  qualifiers?: {
    archivedInTrash?: boolean;
    done?: boolean;
    expression?: string;
    folderNames?: string[];
    ocrTexts?: string[];
    phrases?: string[];
    prices?: import("../../shared/search/qualifiers").PriceBound[];
    sites?: string[];
    tags?: string[];
    todo?: boolean;
  };
  searchQuery?: string;
  semantic: import("../../shared/search/semantic").SemanticRequest | null;
  showTrashOnly?: boolean;
  shuffleSeed?: number;
  similarity: import("../../shared/search/qualifiers").SearchSimilarity | null;
  sort?: "newest" | "oldest" | "relevance" | "shuffle";
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
  pageSnapshotKey?: string;
  source?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  tags?: string[];
  url?: string;
}
interface CreateUploadPayload {
  fileName: string;
  fileSize: number;
  mimeType: string;
}
type QueryValue = boolean | number | string | readonly string[] | undefined;

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

const parseStrictNumber = (raw: string): number | undefined => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

// A missing `limit` takes the default and one above the maximum is clamped,
// but a value that isn't a whole number from 1 up is refused, so a client
// learns its limit was wrong instead of getting a page size it didn't ask for.
const parseLimit = (raw: string | null): number | Response => {
  if (raw === null) {
    return PUBLIC_API_DEFAULT_LIMIT;
  }

  const trimmed = raw.trim();
  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : 0;
  if (parsed < 1) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      `Query parameter \`limit\` must be a whole number from 1 to ${PUBLIC_API_MAX_LIMIT}`
    );
  }

  return Math.min(parsed, PUBLIC_API_MAX_LIMIT);
};

const RATE_LIMITED_ERROR = (retryAt?: number, limit?: number): Response =>
  errorResponse(
    429,
    "RATE_LIMITED",
    "Too many requests",
    { retryAt },
    buildRateLimitHeaders(retryAt, limit)
  );

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

const CONVEX_ERROR_STATUS: Partial<Record<string, number>> = {
  CONFLICT: 409,
  FOLDER_LIMIT: 409,
  HIGHLIGHT_LIMIT: 409,
  NO_ARTICLE: 409,
  QUOTE_NOT_FOUND: 422,
  LIMIT_REACHED: 409,
  NOT_FOUND: 404,
  NOT_IN_TRASH: 409,
  PAGE_SNAPSHOT_TOO_LARGE: 413,
  RULE_LIMIT: 409,
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

  switch (convexFailureKind(error)) {
    case "rateLimitContention":
      return RATE_LIMIT_CONTENTION_ERROR();
    case "writeConflict":
      return SERVICE_BUSY_ERROR();
    default:
      return errorResponse(500, "INTERNAL_ERROR", fallbackMessage);
  }
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

  return parseStrictNumber(value) ?? Number.NaN;
};

export {
  AUTH_INTERNAL_ERROR,
  type AuthorizedUser,
  type AuthResult,
  buildRateLimitHeaders,
  type CardsQueryOptions,
  type CreateCardPayload,
  type CreateUploadPayload,
  type ErrorCode,
  errorResponse,
  MAX_QUERY_SCAN,
  mapConvexErrorToResponse,
  parseBearerToken,
  parseBooleanQuery,
  parseLimit,
  parseTimestampQuery,
  type QueryValue,
  RATE_LIMIT_CONTENTION_ERROR,
  RATE_LIMITED_ERROR,
  SERVICE_BUSY_ERROR,
};
