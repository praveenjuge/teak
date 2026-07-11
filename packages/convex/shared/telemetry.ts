const RELEASE_SHA_LENGTH = 40;
const ATTRIBUTE_STRING_LIMIT = 256;
const ATTRIBUTE_KEY_LIMIT = 64;
const CONTENT_LIMIT = 16_000;
const CONTENT_SEPARATOR = "\n…[content truncated]…\n";

export const TELEMETRY_ENVIRONMENTS = [
  "production",
  "preview",
  "development",
  "test",
] as const;

export type TelemetryEnvironment = (typeof TELEMETRY_ENVIRONMENTS)[number];

export const TELEMETRY_SURFACES = [
  "web",
  "mobile",
  "desktop",
  "backend",
] as const;

export type TelemetrySurface = (typeof TELEMETRY_SURFACES)[number];

export const TELEMETRY_OPERATIONS = {
  auth: "auth",
  billing: "billing",
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

export const TELEMETRY_METRICS = {
  aiCalls: "teak.ai.calls",
  aiCostUsd: "teak.ai.cost.usd",
  aiLatency: "teak.ai.latency",
  aiRetries: "teak.ai.retries",
  aiTokensInput: "teak.ai.tokens.input",
  aiTokensOutput: "teak.ai.tokens.output",
  aiValidationFailures: "teak.ai.validation.failures",
  authBootstrap: "teak.auth.bootstrap",
  authSessionRefresh: "teak.auth.session_refresh",
  authSignIn: "teak.auth.sign_in",
  cardAttempt: "teak.card.create.attempt",
  cardDuration: "teak.card.create.end_to_end_duration",
  cardFailure: "teak.card.create.failure",
  cardSuccess: "teak.card.create.success",
  checkoutCancel: "teak.checkout.cancel",
  checkoutFailure: "teak.checkout.failure",
  checkoutOpen: "teak.checkout.open",
  checkoutStart: "teak.checkout.start",
  checkoutSuccess: "teak.checkout.success",
  cronDuration: "teak.cron.duration",
  cronFailure: "teak.cron.failure",
  cronMissed: "teak.cron.missed",
  cronSuccess: "teak.cron.success",
  desktopCrash: "teak.desktop.crash",
  desktopOauth: "teak.desktop.oauth",
  desktopStartup: "teak.desktop.startup",
  desktopUpdater: "teak.desktop.updater",
  exportLifecycle: "teak.export.lifecycle",
  importLifecycle: "teak.import.lifecycle",
  mobileAppStart: "teak.mobile.app_start",
  mobileCrash: "teak.mobile.crash",
  mobileFrozenFrame: "teak.mobile.frozen_frame",
  mobileHang: "teak.mobile.hang",
  mobileSlowFrame: "teak.mobile.slow_frame",
  searchDuration: "teak.search.duration",
  searchZeroResult: "teak.search.zero_result",
  uploadAttempts: "teak.upload.attempts",
  uploadBytes: "teak.upload.bytes",
  uploadDuration: "teak.upload.duration",
  uploadFailure: "teak.upload.failure",
  userCreated: "teak.user.created",
  workflowFailure: "teak.workflow.failure",
  workflowRetry: "teak.workflow.retry",
  workflowSkip: "teak.workflow.skip",
  workflowStageDuration: "teak.workflow.stage.duration",
} as const;

export type TelemetryMetricName =
  (typeof TELEMETRY_METRICS)[keyof typeof TELEMETRY_METRICS];

export type TelemetryAttributeValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export type TelemetryAttributes = Record<string, TelemetryAttributeValue>;

export interface TelemetryContextInput {
  attributes?: TelemetryAttributes;
  cardId?: string;
  operation: TelemetryOperation;
  release?: string;
  surface: TelemetrySurface;
  traceId?: string;
  userId?: string;
  workflowId?: string;
}

export interface TelemetryContext {
  attributes: TelemetryAttributes;
  cardIdHash?: string;
  operation: TelemetryOperation;
  release?: string;
  surface: TelemetrySurface;
  traceId?: string;
  userIdHash?: string;
  workflowIdHash?: string;
}

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

const cleanVersion = (value: string | undefined): string | undefined => {
  const version = value?.trim().replace(/^v/u, "");
  return version || undefined;
};

const cleanBuild = (value: string | number | undefined): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  const build = typeof value === "string" ? value.trim() : undefined;
  return build || undefined;
};

const cleanSha = (value: string | undefined): string | undefined => {
  const sha = value?.trim().toLowerCase();
  if (!(sha && /^[a-f0-9]{7,64}$/u.test(sha))) {
    return;
  }
  return sha.slice(0, RELEASE_SHA_LENGTH);
};

const buildShaRelease = (
  surface: "web" | "desktop",
  version: string | undefined,
  sha: string | undefined
): string | undefined => {
  const normalizedVersion = cleanVersion(version);
  const normalizedSha = cleanSha(sha);
  if (!(normalizedVersion && normalizedSha)) {
    return;
  }
  return `teak-${surface}@${normalizedVersion}+${normalizedSha}`;
};

export const buildWebRelease = (
  version: string | undefined,
  sha: string | undefined
): string | undefined => buildShaRelease("web", version, sha);

export const buildDesktopRelease = (
  version: string | undefined,
  sha: string | undefined
): string | undefined => buildShaRelease("desktop", version, sha);

export const buildMobileRelease = (
  version: string | undefined,
  buildNumber: string | number | undefined
): string | undefined => {
  const normalizedVersion = cleanVersion(version);
  const normalizedBuild = cleanBuild(buildNumber);
  if (!(normalizedVersion && normalizedBuild)) {
    return;
  }
  return `teak-mobile@${normalizedVersion}+${normalizedBuild}`;
};

export const buildBackendRelease = (
  sha: string | undefined
): string | undefined => {
  const normalizedSha = cleanSha(sha);
  return normalizedSha ? `teak-backend@${normalizedSha}` : undefined;
};

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
  return;
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
  if (/provider|groq|model|generation/u.test(normalized)) {
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
        searchFrom = value.length;
        break search;
      }
      if (value.startsWith(PRIVATE_KEY_BEGIN, marker)) {
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

export const hashTelemetryId = async (
  value: string | undefined
): Promise<string | undefined> => {
  if (!value) {
    return;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const buildTelemetryContext = async ({
  attributes,
  cardId,
  operation,
  release,
  surface,
  traceId,
  userId,
  workflowId,
}: TelemetryContextInput): Promise<TelemetryContext> => ({
  attributes: normalizeTelemetryAttributes(attributes),
  cardIdHash: await hashTelemetryId(cardId),
  operation,
  release,
  surface,
  traceId,
  userIdHash: await hashTelemetryId(userId),
  workflowIdHash: await hashTelemetryId(workflowId),
});

export interface PreparedTelemetryContent {
  content: string;
  contentHash?: string;
  originalLength: number;
  truncated: boolean;
}

export const prepareTelemetryContent = async (
  value: string,
  maxLength = CONTENT_LIMIT
): Promise<PreparedTelemetryContent> => {
  const content = scrubTelemetryString(value);
  if (content.length <= maxLength) {
    return {
      content,
      originalLength: value.length,
      truncated: false,
    };
  }
  const available = Math.max(2, maxLength - CONTENT_SEPARATOR.length);
  const prefixLength = Math.ceil(available / 2);
  const suffixLength = Math.floor(available / 2);
  return {
    content: `${content.slice(0, prefixLength)}${CONTENT_SEPARATOR}${content.slice(
      -suffixLength
    )}`,
    contentHash: await hashTelemetryId(content),
    originalLength: value.length,
    truncated: true,
  };
};

const HIGH_VALUE_OPERATION_PATTERN =
  /auth|card|upload|billing|checkout|import|export|gen_ai|workflow|storage/u;

export interface SamplingContext {
  durationMs?: number;
  environment: TelemetryEnvironment;
  name?: string;
  operation?: string;
  outcome?: string;
}

export const resolveTraceSampleRate = ({
  durationMs,
  environment,
  name,
  operation,
  outcome,
}: SamplingContext): number => {
  if (environment !== "production") {
    return 1;
  }
  const description = `${name ?? ""} ${operation ?? ""}`.toLowerCase();
  const failed = outcome === "failure" || outcome === "error";
  const slow = typeof durationMs === "number" && durationMs >= 2000;
  return failed || slow || HIGH_VALUE_OPERATION_PATTERN.test(description)
    ? 1
    : 0.2;
};
