const ATTRIBUTE_STRING_LIMIT = 256;
const ATTRIBUTE_KEY_LIMIT = 64;

export const TELEMETRY_ENVIRONMENTS = [
  "production",
  "preview",
  "development",
  "test",
] as const;

export type TelemetryEnvironment = (typeof TELEMETRY_ENVIRONMENTS)[number];

export const TELEMETRY_SURFACES = ["web", "mobile", "backend"] as const;

export type TelemetrySurface = (typeof TELEMETRY_SURFACES)[number];

export const TELEMETRY_OPERATIONS = {
  auth: "auth",
  billing: "billing",
  cardCreate: "teak.card.create",
  export: "export",
  genAiGenerate: "gen_ai.generate",
  import: "import",
  storageRender: "storage.render",
  storageUpload: "storage.upload",
  workflow: "teak.workflow",
  workflowStep: "teak.workflow.step",
} as const;

export type TelemetryOperation =
  (typeof TELEMETRY_OPERATIONS)[keyof typeof TELEMETRY_OPERATIONS];

export const TELEMETRY_STAGES = [
  "creation",
  "upload",
  "classification",
  "link_metadata",
  "categorization",
  "ai_metadata",
  "transcript",
  "palette",
  "renderables",
  "persistence",
  "retry",
  "completion",
  "auth_bootstrap",
  "sign_in",
  "session_refresh",
  "checkout",
  "portal",
  "import",
  "export",
  "cron",
] as const;

export type TelemetryStage = (typeof TELEMETRY_STAGES)[number];

export const TELEMETRY_OUTCOMES = [
  "attempt",
  "success",
  "failure",
  "cancelled",
  "skipped",
  "retry",
] as const;

export type TelemetryOutcome = (typeof TELEMETRY_OUTCOMES)[number];

export const TELEMETRY_ERROR_CLASSES = [
  "AbortError",
  "AuthError",
  "NetworkError",
  "NotFoundError",
  "ProviderError",
  "RateLimitError",
  "StorageError",
  "TimeoutError",
  "ValidationError",
  "UnknownError",
] as const;

export type TelemetryErrorClass = (typeof TELEMETRY_ERROR_CLASSES)[number];

export type TelemetryAttributeValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export type TelemetryAttributes = Record<string, TelemetryAttributeValue>;

export interface EnvironmentInput {
  explicit?: string;
  nodeEnvironment?: string;
  vercelEnvironment?: string;
}

const normalizeEnvironment = (
  value: string | undefined
): TelemetryEnvironment | undefined => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return;
  }
  if (["prod", "production", "vercel-production"].includes(normalized)) {
    return "production";
  }
  if (["preview", "staging", "vercel-preview"].includes(normalized)) {
    return "preview";
  }
  if (["test", "testing"].includes(normalized)) {
    return "test";
  }
  return "development";
};

export const resolveTelemetryEnvironment = ({
  explicit,
  nodeEnvironment,
  vercelEnvironment,
}: EnvironmentInput): TelemetryEnvironment =>
  normalizeEnvironment(explicit) ??
  normalizeEnvironment(vercelEnvironment) ??
  normalizeEnvironment(nodeEnvironment) ??
  "development";

const normalizeAttributeKey = (key: string): string | undefined => {
  const normalized = key.trim().slice(0, ATTRIBUTE_KEY_LIMIT);
  return /^[a-z][a-z0-9_.-]*$/u.test(normalized) ? normalized : undefined;
};

const normalizeAttributeValue = (
  value: TelemetryAttributeValue
): Exclude<TelemetryAttributeValue, undefined> | undefined => {
  if (typeof value === "string") {
    return scrubTelemetryString(value).slice(0, ATTRIBUTE_STRING_LIMIT);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
};

export const normalizeTelemetryAttributes = (
  attributes: TelemetryAttributes = {}
): TelemetryAttributes => {
  const normalized: TelemetryAttributes = {};
  for (const [rawKey, rawValue] of Object.entries(attributes)) {
    const key = normalizeAttributeKey(rawKey);
    const value = normalizeAttributeValue(rawValue);
    if (key && value !== undefined) {
      normalized[key] = value;
    }
  }
  return normalized;
};

export const normalizeErrorClass = (error: unknown): TelemetryErrorClass => {
  const value =
    error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const normalized = value.toLowerCase();
  if (error instanceof Error && error.name === "ClientRequestError") {
    return "NetworkError";
  }
  if (/abort|cancel/u.test(normalized)) {
    return "AbortError";
  }
  if (/auth|unauthor|forbidden|session/u.test(normalized)) {
    return "AuthError";
  }
  if (/rate.?limit|too many/u.test(normalized)) {
    return "RateLimitError";
  }
  if (/timeout|timed out/u.test(normalized)) {
    return "TimeoutError";
  }
  if (/valid|schema|parse/u.test(normalized)) {
    return "ValidationError";
  }
  if (/not.?found|missing/u.test(normalized)) {
    return "NotFoundError";
  }
  if (/storage|upload|r2|s3/u.test(normalized)) {
    return "StorageError";
  }
  if (/provider|cloudflare|workers.?ai|model|generation/u.test(normalized)) {
    return "ProviderError";
  }
  if (/network|fetch|connection|socket/u.test(normalized)) {
    return "NetworkError";
  }
  return "UnknownError";
};

const SECRET_ASSIGNMENT_PATTERN =
  /\b([a-z0-9_.-]*(?:api[_-]?key|token|secret|password|credential)[a-z0-9_.-]*)\s*[:=]\s*(["']?)[^\s,"'}]+\2/giu;
const JSON_SECRET_PATTERN =
  /(["'](?:authorization|cookie|session|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)["']\s*:\s*["'])[^"']+(["'])/giu;
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+/=-]+/giu;
const EMAIL_PATTERN =
  /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/giu;
const DATA_URL_PATTERN =
  /data:(?:image|audio|video|application)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/giu;
const PRIVATE_KEY_BEGIN = "-----BEGIN ";
const PRIVATE_KEY_LABEL_SUFFIX = "PRIVATE KEY-----";
const PRIVATE_KEY_LABEL_MAX_LENGTH = 32;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu;
const SIGNED_QUERY_KEYS = new Set([
  "x-amz-algorithm",
  "x-amz-credential",
  "x-amz-date",
  "x-amz-expires",
  "x-amz-security-token",
  "x-amz-signature",
  "sig",
  "signature",
  "signed",
  "token",
]);
const SENSITIVE_KEY_PATTERN =
  /(?:^|[_.-])(?:authorization|cookie|api[_-]?key|apikey|access[_-]?token|accesstoken|refresh[_-]?token|refreshtoken|session[_-]?token|sessiontoken|client[_-]?secret|clientsecret|password|credential|secret|token)(?:$|[_.-])/iu;

const scrubUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    const hasSignedValue = [...url.searchParams.keys()].some((key) =>
      SIGNED_QUERY_KEYS.has(key.toLowerCase())
    );
    if (hasSignedValue || url.username || url.password) {
      return "[REDACTED_SIGNED_URL]";
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
};

const findPrivateKeyLabelEnd = (value: string, start: number): number => {
  const limit = Math.min(
    value.length,
    start + PRIVATE_KEY_LABEL_MAX_LENGTH + 1
  );
  for (let cursor = start; cursor < limit; cursor += 1) {
    if (value.startsWith(PRIVATE_KEY_LABEL_SUFFIX, cursor)) {
      return cursor;
    }
    const code = value.charCodeAt(cursor);
    if (code !== 32 && (code < 65 || code > 90)) {
      return -1;
    }
  }
  return -1;
};

const scrubPrivateKeys = (value: string): string => {
  let output = "";
  let copyFrom = 0;
  let searchFrom = 0;

  search: while (searchFrom < value.length) {
    const begin = value.indexOf(PRIVATE_KEY_BEGIN, searchFrom);
    if (begin === -1) {
      break;
    }

    const labelStart = begin + PRIVATE_KEY_BEGIN.length;
    const labelEnd = findPrivateKeyLabelEnd(value, labelStart);
    if (labelEnd === -1) {
      searchFrom = labelStart;
      continue;
    }

    const label = value.slice(labelStart, labelEnd);
    const contentStart = labelEnd + PRIVATE_KEY_LABEL_SUFFIX.length;
    const endMarker = `-----END ${label}${PRIVATE_KEY_LABEL_SUFFIX}`;
    let blockCursor = contentStart;

    while (blockCursor < value.length) {
      const marker = value.indexOf("-----", blockCursor);
      if (marker === -1) {
        output += `${value.slice(copyFrom, begin)}[REDACTED_PRIVATE_KEY]`;
        copyFrom = value.length;
        searchFrom = value.length;
        break search;
      }
      if (value.startsWith(PRIVATE_KEY_BEGIN, marker)) {
        output += `${value.slice(copyFrom, begin)}[REDACTED_PRIVATE_KEY]`;
        copyFrom = marker;
        searchFrom = marker;
        continue search;
      }
      if (value.startsWith(endMarker, marker)) {
        output += `${value.slice(copyFrom, begin)}[REDACTED_PRIVATE_KEY]`;
        copyFrom = marker + endMarker.length;
        searchFrom = copyFrom;
        continue search;
      }
      blockCursor = marker + 5;
    }

    output += `${value.slice(copyFrom, begin)}[REDACTED_PRIVATE_KEY]`;
    copyFrom = value.length;
    searchFrom = value.length;
  }

  return output + value.slice(copyFrom);
};

export const scrubTelemetryString = (value: string): string =>
  scrubPrivateKeys(value)
    .replace(DATA_URL_PATTERN, "[REDACTED_BINARY_DATA]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(JSON_SECRET_PATTERN, "$1[REDACTED]$2")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[REDACTED]")
    .replace(URL_PATTERN, scrubUrl)
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]");

export const scrubTelemetryValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return scrubTelemetryString(value);
  }
  if (Array.isArray(value)) {
    return value.map(scrubTelemetryValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (typeof child === "string" && SENSITIVE_KEY_PATTERN.test(key)) {
          return [key, "[REDACTED]"];
        }
        return [key, scrubTelemetryValue(child)];
      })
    );
  }
  return value;
};

/** Runs a telemetry call so its failure never reaches the caller. Returns whether it ran. */
export const ignoreTelemetryError = (record: () => void): boolean => {
  try {
    record();
    return true;
  } catch {
    return false;
  }
};

export const ignoreTelemetryErrorAsync = async (
  record: () => Promise<unknown>
): Promise<boolean> => {
  try {
    await record();
    return true;
  } catch {
    return false;
  }
};
