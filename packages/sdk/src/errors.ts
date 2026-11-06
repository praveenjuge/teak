import { PUBLIC_API_ERROR_CODES } from "@teak/convex/shared/publicApiContract";

/** Every `code` a TeakApiError carries: the API's, then the client's own. */
export const ERROR_CODES = [
  ...PUBLIC_API_ERROR_CODES,
  "AUTH_REQUIRED",
  "CONFIG_ERROR",
  "NETWORK_ERROR",
  "PARSE_ERROR",
  "REQUEST_FAILED",
  "TIMEOUT",
] as const;

export type TeakApiErrorCode = (typeof ERROR_CODES)[number];

/**
 * What went wrong, in the few kinds a client words differently: sign in
 * again (`auth`), nothing there (`not_found`), slow down (`rate_limited`),
 * check the connection (`network`), try again later (`unavailable`), change
 * the request (`invalid`), the account is full (`limit`), the library is in
 * another state (`conflict`), not allowed (`forbidden`), the client is set
 * up wrong (`config`), or Teak failed (`server`).
 */
export type TeakErrorKind =
  | "auth"
  | "config"
  | "conflict"
  | "forbidden"
  | "invalid"
  | "limit"
  | "network"
  | "not_found"
  | "rate_limited"
  | "server"
  | "unavailable";

const KIND_BY_CODE: Record<TeakApiErrorCode, TeakErrorKind> = {
  AUTH_REQUIRED: "auth",
  INVALID_API_KEY: "auth",
  UNAUTHORIZED: "auth",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  NO_CONTENT: "not_found",
  RATE_LIMITED: "rate_limited",
  NETWORK_ERROR: "network",
  TIMEOUT: "network",
  SERVICE_UNAVAILABLE: "unavailable",
  IN_PROGRESS: "unavailable",
  BAD_REQUEST: "invalid",
  CONTENT_TOO_LARGE: "invalid",
  FILE_TOO_LARGE: "invalid",
  INVALID_INPUT: "invalid",
  INVALID_STORAGE_KEY: "invalid",
  INVALID_UTF8: "invalid",
  METHOD_NOT_ALLOWED: "invalid",
  PAGE_SNAPSHOT_TOO_LARGE: "invalid",
  QUOTE_NOT_FOUND: "invalid",
  TYPE_MISMATCH: "invalid",
  UNSUPPORTED_TYPE: "invalid",
  CARD_LIMIT_REACHED: "limit",
  FOLDER_LIMIT: "limit",
  HIGHLIGHT_LIMIT: "limit",
  LIMIT_REACHED: "limit",
  PIN_LIMIT_REACHED: "limit",
  RULE_LIMIT: "limit",
  CONFLICT: "conflict",
  NO_ARTICLE: "conflict",
  NOT_IN_TRASH: "conflict",
  SMART_FOLDER: "conflict",
  TAG_EXISTS: "conflict",
  TAG_OPERATION_RUNNING: "conflict",
  CONFIG_ERROR: "config",
  INTERNAL_ERROR: "server",
  PARSE_ERROR: "server",
  REQUEST_FAILED: "server",
};

/** The kind of failure a code names. */
export const errorKindFor = (code: TeakApiErrorCode): TeakErrorKind =>
  KIND_BY_CODE[code] ?? "server";

/** The codes that mean the credential is missing, expired or revoked. */
export const AUTH_ERROR_CODES = ERROR_CODES.filter(
  (code) => errorKindFor(code) === "auth"
);

// Each client says what to do in its own words (`teak login`, Sign In, the
// extension popup); these name none of them.
const DEFAULT_MESSAGE: Partial<Record<TeakErrorKind, string>> = {
  auth: "Sign in to Teak again, or use a valid API key.",
  network: "Unable to reach Teak.",
  not_found: "Teak could not find that resource.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  unavailable: "Teak is busy. Try again in a moment.",
};

const defaultErrorMessage = (code: TeakApiErrorCode) =>
  code === "TIMEOUT"
    ? "The Teak request timed out."
    : (DEFAULT_MESSAGE[errorKindFor(code)] ?? "The Teak request failed.");

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

  /** What went wrong, for a client to word in its own way. */
  get kind(): TeakErrorKind {
    return errorKindFor(this.code);
  }
}

/** The kind of a failure, or undefined when it isn't a Teak API error. */
export const teakErrorKind = (error: unknown): TeakErrorKind | undefined =>
  error instanceof TeakApiError ? error.kind : undefined;

export const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const codeFrom = (
  value: unknown,
  fallback: TeakApiErrorCode
): TeakApiErrorCode =>
  typeof value === "string" &&
  (ERROR_CODES as readonly string[]).includes(value)
    ? (value as TeakApiErrorCode)
    : fallback;

const codeForStatus = (status: number): TeakApiErrorCode => {
  switch (status) {
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 429:
      return "RATE_LIMITED";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED";
  }
};

/** When a `Retry-After` header (seconds or a date) says to try again. */
export const retryAtFromHeader = (value: string | null): number | undefined => {
  if (!value?.trim()) {
    return;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Date.now() + seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : date;
};

/** The error an API response that isn't ok stands for. */
export const errorFromResponse = (response: Response, text: string) => {
  let payload: unknown = null;
  try {
    payload = text.trim() ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const object = isObject(payload) ? payload : {};
  const message =
    typeof object.error === "string" && object.error ? object.error : undefined;
  const code = codeFrom(object.code, codeForStatus(response.status));
  const generic = code === "INTERNAL_ERROR" || code === "REQUEST_FAILED";
  const fallback = generic
    ? `The Teak request failed with HTTP ${response.status}.`
    : undefined;
  return new TeakApiError(code, message === undefined ? fallback : message, {
    requestId: response.headers.get("x-request-id") ?? undefined,
    retryAt:
      typeof object.retryAt === "number"
        ? object.retryAt
        : retryAtFromHeader(response.headers.get("retry-after")),
    status: response.status,
  });
};
