/**
 * Shared HTTP primitives for the public API: response builders, rate-limit
 * errors, query/body parsers, and the request/response types every public
 * API module uses. Pure leaf — no Convex ctx, safe to import anywhere.
 * Split out of `publicApiHttp.ts`, kept behavior-identical.
 */
import { ConvexError } from "convex/values";
import { json } from "./publicApiMeta";

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
const CARD_SORTS = new Set(["newest", "oldest"]);

type ErrorCode =
  | "BAD_REQUEST"
  | "CONFLICT"
  | "CONTENT_TOO_LARGE"
  | "FILE_TOO_LARGE"
  | "INTERNAL_ERROR"
  | "INVALID_API_KEY"
  | "INVALID_INPUT"
  | "INVALID_UTF8"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "TYPE_MISMATCH"
  | "UNAUTHORIZED";

interface AuthorizedUser {
  access: "full_access";
  keyId: string;
  rateLimitKey: string;
  source: "component" | "oauth";
  userId: string;
}

type AuthResult = { validated: AuthorizedUser } | { error: Response };
interface CardsQueryOptions {
  createdAfter?: number;
  createdBefore?: number;
  cursor?: string;
  favoritesOnly: boolean;
  limit: number;
  searchQuery?: string;
  sort?: "newest" | "oldest";
  tag?: string;
  type?: string;
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
type QueryValue = boolean | number | string | undefined;
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

const buildRateLimitHeaders = (retryAt?: number): HeadersInit | undefined => {
  if (!(typeof retryAt === "number" && Number.isFinite(retryAt))) {
    return;
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((retryAt - Date.now()) / 1000)
  );
  return {
    "RateLimit-Limit": "120",
    "RateLimit-Remaining": "0",
    "RateLimit-Reset": String(retryAt),
    "Retry-After": String(retryAfterSeconds),
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

const isRateLimitContentionError = (error: unknown): boolean => {
  let message: string | undefined;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    message = error.message;
  }
  if (!message) {
    return false;
  }

  return (
    message.includes('"rateLimits" table') &&
    message.includes(
      "changed while this mutation was being run and on every subsequent retry"
    )
  );
};

const RATE_LIMITED_ERROR = (retryAt?: number): Response =>
  errorResponse(
    429,
    "RATE_LIMITED",
    "Too many requests",
    { retryAt },
    buildRateLimitHeaders(retryAt)
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

const mapConvexErrorToResponse = (
  error: unknown,
  fallbackMessage: string
): Response => {
  if (error instanceof ConvexError) {
    const payload = (error.data ?? {}) as {
      code?: unknown;
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
        buildRateLimitHeaders(retryAt)
      );
    }

    return json(400, {
      code,
      error: message,
    });
  }

  if (isRateLimitContentionError(error)) {
    return RATE_LIMIT_CONTENTION_ERROR();
  }

  return errorResponse(500, "INTERNAL_ERROR", fallbackMessage);
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
  isRateLimitContentionError,
  MAX_BULK_ITEMS,
  MAX_LIMIT,
  MAX_QUERY_SCAN,
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
  sha256,
};
