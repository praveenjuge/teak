import { ConvexError } from "convex/values";
import { components, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { isLocalDevelopmentHostname, resolveTeakDevAppUrl } from "./devUrls";
import { isWellFormedOAuthToken } from "./oauthTokens";
import { isWellFormedApiKey } from "./shared/apiKeyFormat";
import { MAX_FILE_SIZE } from "./shared/constants";
import { isSafeExternalUrl } from "./shared/utils/safeUrl";
import { r2ComponentConfig } from "./storage/r2";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_QUERY_SCAN = 400;
const MAX_BULK_ITEMS = 100;
const APP_PROD_URL = "https://app.teakvault.com";
const APP_DEV_URL = resolveTeakDevAppUrl(process.env);
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
  | "INTERNAL_ERROR"
  | "INVALID_API_KEY"
  | "INVALID_INPUT"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
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

type CardListInclude = "content" | "metadata" | "processing";

const json = (status: number, body: unknown, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...(headers ?? {}),
    },
  });

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
  if (!raw) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
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

const buildIdempotentResponse = (record: {
  responseBody: unknown;
  responseStatus: number;
}): Response => json(record.responseStatus, record.responseBody);

interface IdempotencyState {
  keyHash: string;
  replayed?: Response;
  requestHash: string;
  reserved: boolean;
}

const trackIdempotency = async (
  ctx: any,
  endpoint: string,
  outcome: string
) => {
  await ctx.runMutation(
    (internal as any).idempotencyAnalytics.trackIdempotencyOutcome,
    { endpoint, outcome }
  );
};

const maybeHandleIdempotency = async (
  ctx: any,
  args: {
    userId: string;
    method: "POST";
    path: string;
    requestBody: unknown;
    request: Request;
  }
): Promise<IdempotencyState | Response> => {
  const idempotencyKey = parseOptionalString(
    args.request.headers.get("idempotency-key")
  );
  if (!idempotencyKey) {
    await trackIdempotency(ctx, args.path, "skipped");
    return {
      keyHash: "",
      requestHash: "",
      reserved: false,
    };
  }

  const [keyHash, requestHash] = await Promise.all([
    sha256(`${args.userId}:${idempotencyKey}`),
    sha256(
      JSON.stringify({
        body: args.requestBody,
        method: args.method,
        path: args.path,
      })
    ),
  ]);

  const reservation = await ctx.runMutation(
    (internal as any).idempotency.beginIdempotencyRequestForUser,
    {
      keyHash,
      method: args.method,
      path: args.path,
      requestHash,
      userId: args.userId,
    }
  );

  switch (reservation.status) {
    case "started":
      await trackIdempotency(ctx, args.path, "started");
      return { keyHash, requestHash, reserved: true };
    case "replay":
      await trackIdempotency(ctx, args.path, "replayed");
      return {
        keyHash,
        requestHash,
        reserved: false,
        replayed: buildIdempotentResponse(reservation.record),
      };
    case "in_progress":
      await trackIdempotency(ctx, args.path, "in_progress");
      return errorResponse(
        409,
        "CONFLICT",
        "Idempotency-Key is already being processed"
      );
    case "conflict":
      await trackIdempotency(ctx, args.path, "conflict");
      return errorResponse(
        409,
        "CONFLICT",
        "Idempotency-Key was already used with a different request"
      );
    default:
      await trackIdempotency(ctx, args.path, "error");
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        "Failed to reserve Idempotency-Key"
      );
  }
};

const completeIdempotencyResponse = async (
  ctx: any,
  args: {
    userId: string;
    keyHash: string;
    requestHash: string;
    responseBody: unknown;
    responseStatus: number;
  }
): Promise<void> => {
  if (!args.keyHash) {
    return;
  }

  await ctx.runMutation(
    (internal as any).idempotency.completeIdempotencyRequestForUser,
    {
      keyHash: args.keyHash,
      requestHash: args.requestHash,
      responseBody: args.responseBody,
      responseStatus: args.responseStatus,
      userId: args.userId,
    }
  );
};

const releaseIdempotencyResponse = async (
  ctx: any,
  args: {
    userId: string;
    keyHash: string;
    requestHash: string;
  }
): Promise<void> => {
  if (!args.keyHash) {
    return;
  }

  await ctx.runMutation(
    (internal as any).idempotency.releaseIdempotencyRequestForUser,
    args
  );
};

const isRateLimitContentionError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('"rateLimits" table') &&
    error.message.includes(
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

// Throttle well-formed-but-invalid API keys via a single shared bucket so an
// attacker rotating random bearer tokens cannot mint a fresh limit per token.
// Returns a 429 Response when the shared bucket is exhausted, otherwise null.
const enforceInvalidAuthLimit = async (ctx: any): Promise<Response | null> => {
  let limit: { ok?: boolean; retryAt?: number } | null = null;
  try {
    limit = await ctx.runMutation(
      (internal as any).raycast.consumeInvalidApiAuthLimit,
      {}
    );
  } catch (error) {
    if (isRateLimitContentionError(error)) {
      return RATE_LIMIT_CONTENTION_ERROR();
    }
    // Never fail open on the invalid-auth path: surface a generic auth error.
    return AUTH_INTERNAL_ERROR();
  }

  if (!limit?.ok) {
    return RATE_LIMITED_ERROR(limit?.retryAt);
  }

  return null;
};

const withAuthorizedUser = async (
  ctx: any,
  request: Request
): Promise<AuthResult> => {
  const token = parseBearerToken(request);
  if (!token) {
    return {
      error: errorResponse(
        401,
        "UNAUTHORIZED",
        "Missing or invalid Authorization header"
      ),
    };
  }

  // Two bearer credential shapes are accepted: `teakapi_` API keys and opaque
  // 32-char OAuth access tokens. Discriminate on shape before any DB read so
  // the cheapest abuse vector (spraying random tokens) is rejected without a
  // write, and so failures can return the right error code per credential type.
  const isApiKey = isWellFormedApiKey(token);
  const isOAuthToken = !isApiKey && isWellFormedOAuthToken(token);

  if (!(isApiKey || isOAuthToken)) {
    const limited = await enforceInvalidAuthLimit(ctx);
    if (limited) {
      return { error: limited };
    }
    return {
      error: errorResponse(
        401,
        "INVALID_API_KEY",
        "Invalid or revoked API key"
      ),
    };
  }

  // Validate first. Both validators are effectively read-only on the hot path
  // (the API-key one only writes a throttled lastUsedAt), so doing it before
  // rate limiting lets us key the limiter on a stable identity instead of the
  // attacker-controlled raw token.
  let validated: AuthorizedUser | null = null;
  try {
    validated = isApiKey
      ? await ctx.runMutation((internal as any).apiKeys.validateUserApiKey, {
          token,
        })
      : await ctx.runMutation(
          (internal as any).oauthTokens.validateOAuthAccessToken,
          { token }
        );
  } catch {
    return { error: AUTH_INTERNAL_ERROR() };
  }

  if (!validated) {
    const limited = await enforceInvalidAuthLimit(ctx);
    if (limited) {
      return { error: limited };
    }
    return {
      error: isOAuthToken
        ? errorResponse(401, "UNAUTHORIZED", "Invalid or expired access token")
        : errorResponse(401, "INVALID_API_KEY", "Invalid or revoked API key"),
    };
  }

  // Rate limit successful auth per validated identity, so the limit follows the
  // real key / OAuth app+user rather than whatever token string the caller sent.
  let rateLimit: { ok?: boolean; retryAt?: number } | null = null;
  try {
    rateLimit = await ctx.runMutation(
      (internal as any).raycast.checkApiRateLimit,
      {
        rateLimitKey: `key:${validated.rateLimitKey}`,
      }
    );
  } catch (error) {
    if (isRateLimitContentionError(error)) {
      return { error: RATE_LIMIT_CONTENTION_ERROR() };
    }
    return { error: AUTH_INTERNAL_ERROR() };
  }

  if (!rateLimit?.ok) {
    return { error: RATE_LIMITED_ERROR(rateLimit?.retryAt) };
  }

  return { validated };
};

const getAppBaseUrl = (requestUrl: string): string => {
  const { hostname } = new URL(requestUrl);
  return isLocalDevelopmentHostname(hostname) ? APP_DEV_URL : APP_PROD_URL;
};

const getCardAppUrl = (requestUrl: string, cardId: string): string => {
  const appUrl = new URL(getAppBaseUrl(requestUrl));
  appUrl.searchParams.set("card", cardId);
  return appUrl.toString();
};

const serializeCard = (card: any, requestUrl: string) => ({
  aiSummary: card.aiSummary ?? null,
  aiTags: card.aiTags ?? [],
  appUrl: getCardAppUrl(requestUrl, card._id),
  content: card.content,
  createdAt: card.createdAt,
  fileUrl: card.fileUrl ?? null,
  id: card._id,
  isFavorited: Boolean(card.isFavorited),
  linkPreviewImageUrl: card.linkPreviewImageUrl ?? null,
  metadataDescription: card.metadataDescription ?? null,
  metadataTitle: card.metadataTitle ?? null,
  notes: card.notes ?? null,
  screenshotUrl: card.screenshotUrl ?? null,
  tags: card.tags ?? [],
  thumbnailUrl: card.thumbnailUrl ?? null,
  type: card.type,
  updatedAt: card.updatedAt,
  url: card.url ?? null,
});

const serializeListCard = (
  card: any,
  requestUrl: string,
  include: Set<CardListInclude>
) => {
  const base = {
    aiTags: card.aiTags ?? [],
    appUrl: getCardAppUrl(requestUrl, card._id),
    createdAt: card.createdAt,
    id: card._id,
    isFavorited: Boolean(card.isFavorited),
    metadataDescription: card.metadataDescription ?? null,
    metadataTitle: card.metadataTitle ?? null,
    tags: card.tags ?? [],
    type: card.type,
    updatedAt: card.updatedAt,
    url: card.url ?? null,
  };

  return {
    ...base,
    ...(include.has("content")
      ? {
          aiSummary: card.aiSummary ?? null,
          content: card.content,
          notes: card.notes ?? null,
        }
      : {}),
    ...(include.has("metadata")
      ? {
          fileUrl: card.fileUrl ?? null,
          linkPreviewImageUrl: card.linkPreviewImageUrl ?? null,
          screenshotUrl: card.screenshotUrl ?? null,
          thumbnailUrl: card.thumbnailUrl ?? null,
        }
      : {}),
    ...(include.has("processing")
      ? {
          aiTranscript: card.aiTranscript ?? null,
          metadataStatus: card.metadataStatus ?? null,
          processingStatus: card.processingStatus ?? null,
        }
      : {}),
  };
};

const mapConvexErrorToResponse = (
  error: unknown,
  fallbackMessage: string
): Response => {
  if (error instanceof ConvexError) {
    const payload = (error.data ?? {}) as {
      code?: unknown;
      message?: unknown;
    };

    const code =
      typeof payload.code === "string"
        ? (payload.code as ErrorCode)
        : "BAD_REQUEST";
    const message =
      typeof payload.message === "string" ? payload.message : fallbackMessage;

    return json(400, {
      code,
      error: message,
    });
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

const parseIncludeSet = (value: string | null): Set<CardListInclude> | null => {
  if (!value) {
    return new Set();
  }

  const allowed = new Set<CardListInclude>([
    "content",
    "metadata",
    "processing",
  ]);
  const requested = new Set<CardListInclude>();

  for (const token of value.split(",")) {
    const normalized = token.trim();
    if (!normalized) {
      continue;
    }
    if (!allowed.has(normalized as CardListInclude)) {
      return null;
    }
    requested.add(normalized as CardListInclude);
  }

  return requested;
};

const validateCreatePayload = (payload: unknown): CreateCardPayload | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const source = payload as Record<string, unknown>;
  const allowedKeys = new Set([
    "cardType",
    "content",
    "fileKey",
    "fileName",
    "fileSize",
    "mimeType",
    "notes",
    "source",
    "tags",
    "url",
  ]);

  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) {
      return null;
    }
  }

  const content = parseOptionalString(source.content);
  const url = parseOptionalString(source.url);
  const fileKey = parseOptionalString(source.fileKey);
  const fileName = parseOptionalString(source.fileName);
  const mimeType = parseOptionalString(source.mimeType);
  const cardType = parseOptionalString(source.cardType);
  const notes = parseOptionalNullableString(source.notes);
  const sourceValue = parseOptionalString(source.source);
  const tags =
    source.tags === undefined ? undefined : parseStringArray(source.tags);
  const fileSize =
    source.fileSize === undefined || typeof source.fileSize === "number"
      ? source.fileSize
      : Number.NaN;

  if (source.tags !== undefined && tags === undefined) {
    return null;
  }

  if (url !== undefined && !isSafeExternalUrl(url)) {
    return null;
  }
  if (cardType !== undefined && !CARD_TYPES.has(cardType)) {
    return null;
  }
  if (fileSize !== undefined && !Number.isFinite(fileSize)) {
    return null;
  }

  if (
    source.notes !== undefined &&
    !(typeof source.notes === "string" || source.notes === null)
  ) {
    return null;
  }

  if (fileKey) {
    if (!(cardType && fileName && mimeType) || url) {
      return null;
    }
    return {
      cardType,
      content,
      fileKey,
      fileName,
      fileSize,
      mimeType,
      notes,
      source: sourceValue,
      tags,
    };
  }

  if (!(content || url) || cardType || fileName || mimeType) {
    return null;
  }

  return {
    content,
    notes,
    source: sourceValue,
    tags,
    url,
  };
};

const validateUploadPayload = (
  payload: unknown
): CreateUploadPayload | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const source = payload as Record<string, unknown>;
  const allowedKeys = new Set(["fileName", "fileSize", "mimeType"]);

  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) {
      return null;
    }
  }

  const fileName = parseOptionalString(source.fileName);
  const mimeType = parseOptionalString(source.mimeType);
  const fileSize = source.fileSize;
  if (!(fileName && mimeType && typeof fileSize === "number")) {
    return null;
  }
  return { fileName, fileSize, mimeType };
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

  return;
};

const parseTimestampQuery = (value: string | null): number | undefined => {
  if (!value) {
    return;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const parseCardsQueryOptions = (
  request: Request,
  favoritesOnly: boolean
): CardsQueryOptions | Response => {
  const { searchParams } = new URL(request.url);
  const query = parseOptionalString(searchParams.get("q"));
  const type = parseOptionalString(searchParams.get("type"));
  const tag = parseOptionalString(searchParams.get("tag"));
  const sort = parseOptionalString(searchParams.get("sort"));
  const createdAfter = parseTimestampQuery(searchParams.get("createdAfter"));
  const createdBefore = parseTimestampQuery(searchParams.get("createdBefore"));
  const favorited = parseBooleanQuery(searchParams.get("favorited"));

  if (type && !CARD_TYPES.has(type)) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `type` is invalid"
    );
  }

  if (sort && !CARD_SORTS.has(sort)) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `sort` must be `newest` or `oldest`"
    );
  }

  if (createdAfter !== undefined && Number.isNaN(createdAfter)) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `createdAfter` must be a number"
    );
  }

  if (createdBefore !== undefined && Number.isNaN(createdBefore)) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `createdBefore` must be a number"
    );
  }

  if (
    createdAfter !== undefined &&
    createdBefore !== undefined &&
    createdAfter > createdBefore
  ) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "`createdAfter` must be less than or equal to `createdBefore`"
    );
  }

  if (searchParams.has("favorited") && favorited === undefined) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `favorited` must be `true` or `false`"
    );
  }

  return {
    createdAfter,
    createdBefore,
    cursor: parseOptionalString(searchParams.get("cursor")),
    favoritesOnly: favoritesOnly || favorited === true,
    limit: parseLimit(searchParams.get("limit")),
    searchQuery: query,
    sort: sort as CardsQueryOptions["sort"] | undefined,
    tag,
    type,
  };
};

const buildCreateCardResponse = (
  result: { card?: any; cardId: string; status: "created" },
  requestUrl: string
) => {
  const card = result.card ? serializeCard(result.card, requestUrl) : undefined;
  return {
    appUrl: getCardAppUrl(requestUrl, result.cardId),
    card,
    cardId: result.cardId,
    status: result.status,
  };
};

const verifyUploadedFile = async (
  ctx: any,
  payload: CreateCardPayload
): Promise<{ storedFileSize: number; storedMimeType?: string }> => {
  if (!payload.fileKey) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "fileKey is required",
    });
  }

  const config = r2ComponentConfig();
  try {
    await ctx.runAction(components.r2.lib.syncMetadata, {
      key: payload.fileKey,
      ...config,
    });
  } catch {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Uploaded file was not found",
    });
  }

  const metadata = await ctx.runQuery(components.r2.lib.getMetadata, {
    key: payload.fileKey,
    ...config,
  });

  if (!metadata || typeof metadata.size !== "number") {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Uploaded file metadata is unavailable",
    });
  }

  if (metadata.size > MAX_FILE_SIZE) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: `Uploaded file must not exceed ${MAX_FILE_SIZE} bytes`,
    });
  }

  const storedMimeType =
    typeof metadata.contentType === "string"
      ? metadata.contentType.trim().toLowerCase()
      : undefined;
  const requestedMimeType = payload.mimeType?.trim().toLowerCase();

  if (payload.fileSize !== undefined && payload.fileSize !== metadata.size) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Uploaded file size does not match the stored object",
    });
  }

  if (
    requestedMimeType &&
    storedMimeType &&
    requestedMimeType !== storedMimeType
  ) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Uploaded file type does not match the stored object",
    });
  }

  return { storedFileSize: metadata.size, storedMimeType };
};

const handleCreateCardRequest = async (
  ctx: any,
  request: Request
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(request);
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const createPayload = validateCreatePayload(payload);
  if (!createPayload) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Body must include `content` or `url` and only valid fields: content, url, notes, tags, source"
    );
  }

  let idempotencyState: IdempotencyState | null = null;
  let operationCommitted = false;

  try {
    const idempotency = await maybeHandleIdempotency(ctx, {
      method: "POST",
      path: "/v1/cards",
      request,
      requestBody: createPayload,
      userId: auth.validated.userId,
    });
    if (idempotency instanceof Response) {
      return idempotency;
    }
    if (idempotency.replayed) {
      return idempotency.replayed;
    }
    idempotencyState = idempotency;

    const uploadMetadata = createPayload.fileKey
      ? await verifyUploadedFile(ctx, createPayload)
      : null;
    const result = uploadMetadata
      ? await ctx.runMutation(
          (internal as any).publicApiUploads.finalizeUploadedCardForUser,
          {
            cardType: createPayload.cardType,
            content: createPayload.content,
            fileKey: createPayload.fileKey,
            fileName: createPayload.fileName,
            fileSize: createPayload.fileSize,
            mimeType: createPayload.mimeType,
            notes:
              createPayload.notes === null ? undefined : createPayload.notes,
            storedFileSize: uploadMetadata.storedFileSize,
            storedMimeType: uploadMetadata.storedMimeType,
            tags: createPayload.tags,
            userId: auth.validated.userId,
          }
        )
      : await ctx.runMutation((internal as any).raycast.quickSaveForUser, {
          content: createPayload.content,
          notes: createPayload.notes === null ? undefined : createPayload.notes,
          source: createPayload.source,
          tags: createPayload.tags,
          url: createPayload.url,
          userId: auth.validated.userId,
        });
    operationCommitted = true;
    const responseBody = buildCreateCardResponse(result, request.url);
    await completeIdempotencyResponse(ctx, {
      keyHash: idempotencyState.keyHash,
      requestHash: idempotencyState.requestHash,
      responseBody,
      responseStatus: 200,
      userId: auth.validated.userId,
    });

    return json(200, responseBody);
  } catch (error) {
    if (idempotencyState?.reserved && !operationCommitted) {
      try {
        await releaseIdempotencyResponse(ctx, {
          keyHash: idempotencyState.keyHash,
          requestHash: idempotencyState.requestHash,
          userId: auth.validated.userId,
        });
      } catch {
        // Preserve the original mutation error when reservation cleanup fails.
      }
    }
    return mapConvexErrorToResponse(error, "Failed to save card");
  }
};

const handleCreateUploadRequest = async (
  ctx: any,
  request: Request
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(request);
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const uploadPayload = validateUploadPayload(payload);
  if (!uploadPayload) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Body must include only valid fields: fileName, mimeType, fileSize"
    );
  }

  try {
    const result = await ctx.runMutation(
      (internal as any).publicApiUploads.generateUploadUrlForUser,
      {
        ...uploadPayload,
        userId: auth.validated.userId,
      }
    );
    return json(200, result);
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to prepare upload");
  }
};

const handleCardsQueryRequest = async (
  ctx: any,
  request: Request,
  favoritesOnly: boolean
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  const options = parseCardsQueryOptions(request, favoritesOnly);
  if (options instanceof Response) {
    return options;
  }

  try {
    const cards = await ctx.runQuery(
      favoritesOnly
        ? (internal as any).raycast.favoriteCardsForUser
        : (internal as any).raycast.searchCardsForUser,
      {
        ...options,
        userId: auth.validated.userId,
      }
    );

    return json(200, {
      items: cards.map((card: any) => serializeCard(card, request.url)),
      total: cards.length,
    });
  } catch {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      favoritesOnly ? "Failed to fetch favorite cards" : "Failed to fetch cards"
    );
  }
};

const handleCardsListRequest = async (
  ctx: any,
  request: Request
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  const options = parseCardsQueryOptions(request, false);
  if (options instanceof Response) {
    return options;
  }

  const include = parseIncludeSet(
    new URL(request.url).searchParams.get("include")
  );
  if (include === null) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `include` must contain only: content, metadata, processing"
    );
  }

  try {
    const queryArgs = {
      createdAfter: options.createdAfter,
      createdBefore: options.createdBefore,
      cursor: options.cursor,
      favorited: options.favoritesOnly ? true : undefined,
      sort: options.sort,
      type: options.type,
      userId: auth.validated.userId,
    };
    let cardsPage: {
      items: any[];
      pageInfo: { hasMore: boolean; nextCursor: string | null };
    };

    if (options.searchQuery || options.tag) {
      cardsPage = await ctx.runQuery(
        (internal as any).publicApi.searchCardsPageForUser,
        {
          ...queryArgs,
          limit: options.limit,
          searchQuery: options.searchQuery,
          tag: options.tag,
        }
      );
    } else {
      const items: any[] = [];
      let cursor = options.cursor;
      let nextCursor: string | null = null;
      let scannedRows = 0;
      let hasMore = false;

      while (scannedRows < MAX_QUERY_SCAN) {
        const scanLimit = Math.min(MAX_LIMIT, MAX_QUERY_SCAN - scannedRows);
        const scanPage = await ctx.runQuery(
          (internal as any).publicApi.scanCardsPageForUser,
          {
            ...queryArgs,
            cursor,
            scanLimit,
          }
        );
        const rowsRead = Math.max(
          0,
          Math.min(scanLimit, Number(scanPage.scannedRows) || 0)
        );
        scannedRows += rowsRead;

        for (const [index, card] of scanPage.items.entries()) {
          if (items.length === options.limit) {
            hasMore = true;
            break;
          }

          items.push(card);
          nextCursor = scanPage.itemCursors[index] ?? null;
        }

        if (hasMore) {
          break;
        }

        cursor = scanPage.nextCursor ?? undefined;
        if (!cursor) {
          nextCursor = null;
          break;
        }

        if (items.length === options.limit) {
          // Every matching card in this physical page was consumed, so the
          // public cursor can advance past its remaining non-matching rows.
          nextCursor = cursor;
        }

        if (rowsRead === 0) {
          // A non-advancing split should never spin the HTTP action forever.
          hasMore = true;
          nextCursor = cursor;
          break;
        }
      }

      if (!hasMore && scannedRows >= MAX_QUERY_SCAN && cursor) {
        hasMore = true;
        nextCursor = cursor;
      }

      cardsPage = {
        items,
        pageInfo: {
          hasMore,
          nextCursor: hasMore ? nextCursor : null,
        },
      };
    }

    return json(200, {
      items: cardsPage.items.map((card: any) =>
        serializeListCard(card, request.url, include)
      ),
      pageInfo: cardsPage.pageInfo,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to fetch cards");
  }
};

const parseCardRoute = (
  request: Request
): {
  cardId: string;
  operation: "delete" | "favorite" | "get" | "patch";
} | null => {
  const { pathname } = new URL(request.url);
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length < 3 || segments[0] !== "v1" || segments[1] !== "cards") {
    return null;
  }

  const cardId = segments[2];
  if (!cardId) {
    return null;
  }

  if (request.method === "GET" && segments.length === 3) {
    return { cardId, operation: "get" };
  }

  if (request.method === "DELETE" && segments.length === 3) {
    return { cardId, operation: "delete" };
  }

  if (request.method !== "PATCH") {
    return null;
  }

  if (segments.length === 3) {
    return { cardId, operation: "patch" };
  }

  if (segments.length === 4 && segments[3] === "favorite") {
    return { cardId, operation: "favorite" };
  }

  return null;
};

const resolveCardId = (ctx: any, cardId: string): Promise<string | null> =>
  ctx.runQuery((internal as any).raycast.resolveCardIdForUserRequest, {
    cardId,
  });

const ensureCardExistsForUser = (
  ctx: any,
  userId: string,
  cardId: string
): Promise<any | null> =>
  ctx.runQuery((internal as any).raycast.getCardForUser, {
    cardId,
    userId,
  });

const validatePatchPayload = (
  payload: unknown
): {
  content?: string;
  notes?: string | null;
  tags?: string[];
  url?: string;
} | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const source = payload as Record<string, unknown>;
  const allowedKeys = new Set(["content", "notes", "tags", "url"]);

  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) {
      return null;
    }
  }

  const next: {
    content?: string;
    notes?: string | null;
    tags?: string[];
    url?: string;
  } = {};

  if ("content" in source) {
    if (typeof source.content !== "string" || !source.content.trim()) {
      return null;
    }
    next.content = source.content.trim();
  }

  if ("url" in source) {
    if (typeof source.url !== "string" || !source.url.trim()) {
      return null;
    }
    const trimmedUrl = source.url.trim();
    if (!isSafeExternalUrl(trimmedUrl)) {
      return null;
    }
    next.url = trimmedUrl;
  }

  if ("notes" in source) {
    if (!(typeof source.notes === "string" || source.notes === null)) {
      return null;
    }
    next.notes =
      typeof source.notes === "string" ? source.notes.trim() || null : null;
  }

  if ("tags" in source) {
    const tags = parseStringArray(source.tags);
    if (tags === undefined) {
      return null;
    }
    next.tags = tags;
  }

  if (Object.keys(next).length === 0) {
    return null;
  }

  return next;
};

const validateFavoritePayload = (
  payload: unknown
): { isFavorited: boolean } | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const source = payload as Record<string, unknown>;
  if (Object.keys(source).length !== 1 || !("isFavorited" in source)) {
    return null;
  }

  if (typeof source.isFavorited !== "boolean") {
    return null;
  }

  return { isFavorited: source.isFavorited };
};

const handleCardsByIdV1Request = async (
  ctx: any,
  request: Request
): Promise<Response> => {
  const route = parseCardRoute(request);
  if (!route) {
    return errorResponse(404, "NOT_FOUND", "Card route not found");
  }

  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  const normalizedCardId = await resolveCardId(ctx, route.cardId);
  if (!normalizedCardId) {
    return errorResponse(404, "NOT_FOUND", "Card not found");
  }

  const currentCard = await ensureCardExistsForUser(
    ctx,
    auth.validated.userId,
    normalizedCardId
  );
  if (!currentCard) {
    return errorResponse(404, "NOT_FOUND", "Card not found");
  }

  if (route.operation === "get") {
    return json(200, serializeCard(currentCard, request.url));
  }

  if (route.operation === "delete") {
    try {
      await ctx.runMutation((internal as any).raycast.softDeleteCardForUser, {
        cardId: normalizedCardId,
        userId: auth.validated.userId,
      });
      return new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      return mapConvexErrorToResponse(error, "Failed to delete card");
    }
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(request);
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (route.operation === "patch") {
    const patchPayload = validatePatchPayload(payload);
    if (!patchPayload) {
      return errorResponse(
        400,
        "INVALID_INPUT",
        "Body must include at least one valid field: content, url, notes, tags"
      );
    }

    try {
      const updated = await ctx.runMutation(
        (internal as any).raycast.patchCardForUser,
        {
          ...patchPayload,
          cardId: normalizedCardId,
          userId: auth.validated.userId,
        }
      );

      if (!updated) {
        return errorResponse(404, "NOT_FOUND", "Card not found");
      }

      return json(200, serializeCard(updated, request.url));
    } catch (error) {
      return mapConvexErrorToResponse(error, "Failed to update card");
    }
  }

  const favoritePayload = validateFavoritePayload(payload);
  if (route.operation === "favorite") {
    if (!favoritePayload) {
      return errorResponse(
        400,
        "INVALID_INPUT",
        "Body must include `isFavorited` as a boolean"
      );
    }

    try {
      const updated = await ctx.runMutation(
        (internal as any).raycast.setCardFavoriteForUser,
        {
          cardId: normalizedCardId,
          isFavorited: favoritePayload.isFavorited,
          userId: auth.validated.userId,
        }
      );

      if (!updated) {
        return errorResponse(404, "NOT_FOUND", "Card not found");
      }

      return json(200, serializeCard(updated, request.url));
    } catch (error) {
      return mapConvexErrorToResponse(
        error,
        "Failed to update favorite status"
      );
    }
  }

  return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
};

const handleTagsRequest = async (
  ctx: any,
  request: Request
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  try {
    const tags = await ctx.runQuery(
      (internal as any).publicApi.listTagsForUser,
      {
        userId: auth.validated.userId,
      }
    );
    return json(200, { items: tags });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to fetch tags");
  }
};

const handleCardChangesRequest = async (
  ctx: any,
  request: Request
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  const { searchParams } = new URL(request.url);
  const since = parseTimestampQuery(searchParams.get("since"));
  if (!(typeof since === "number" && Number.isFinite(since))) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `since` must be a number"
    );
  }

  try {
    const changes = await ctx.runQuery(
      (internal as any).publicApi.listCardChangesForUser,
      {
        cursor: parseOptionalString(searchParams.get("cursor")),
        limit: parseLimit(searchParams.get("limit")),
        since,
        userId: auth.validated.userId,
      }
    );

    return json(200, {
      deletedIds: changes.deletedIds,
      items: changes.items.map((card: any) => serializeCard(card, request.url)),
      pageInfo: changes.pageInfo,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Failed to fetch card changes");
  }
};

const handleBulkCardsRequest = async (
  ctx: any,
  request: Request
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(request);
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Body must include `operation` and `items`"
    );
  }

  const source = payload as Record<string, unknown>;
  const operation = parseOptionalString(source.operation);
  const items = Array.isArray(source.items) ? source.items : null;
  if (
    !(
      operation &&
      items &&
      ["create", "update", "favorite", "delete"].includes(operation)
    )
  ) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Body must include a valid `operation` and `items`"
    );
  }

  if (items.length === 0) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "`items` must include at least one item"
    );
  }

  if (items.length > MAX_BULK_ITEMS) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      `\`items\` must not exceed ${MAX_BULK_ITEMS} entries per request`
    );
  }

  let idempotencyState: IdempotencyState | null = null;
  let operationCommitted = false;

  try {
    const idempotency = await maybeHandleIdempotency(ctx, {
      method: "POST",
      path: "/v1/cards/bulk",
      request,
      requestBody: { items, operation },
      userId: auth.validated.userId,
    });
    if (idempotency instanceof Response) {
      return idempotency;
    }
    if (idempotency.replayed) {
      return idempotency.replayed;
    }
    idempotencyState = idempotency;

    const result = await ctx.runMutation(
      (internal as any).publicApi.executeBulkCardsForUser,
      {
        items,
        operation,
        userId: auth.validated.userId,
      }
    );
    operationCommitted = true;
    await completeIdempotencyResponse(ctx, {
      keyHash: idempotencyState.keyHash,
      requestHash: idempotencyState.requestHash,
      responseBody: result,
      responseStatus: 200,
      userId: auth.validated.userId,
    });

    return json(200, result);
  } catch (error) {
    if (idempotencyState?.reserved && !operationCommitted) {
      try {
        await releaseIdempotencyResponse(ctx, {
          keyHash: idempotencyState.keyHash,
          requestHash: idempotencyState.requestHash,
          userId: auth.validated.userId,
        });
      } catch {
        // Preserve the original mutation error when reservation cleanup fails.
      }
    }
    return mapConvexErrorToResponse(error, "Failed to execute bulk operation");
  }
};

export const createCardV1 = httpAction((ctx, request) => {
  if (request.method !== "POST") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCreateCardRequest(ctx, request);
});

export const createUploadV1 = httpAction((ctx, request) => {
  if (request.method !== "POST") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCreateUploadRequest(ctx, request);
});

export const listCardsV1 = httpAction((ctx, request) => {
  if (request.method !== "GET") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCardsListRequest(ctx, request);
});

export const searchCardsV1 = httpAction((ctx, request) => {
  if (request.method !== "GET") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCardsQueryRequest(ctx, request, false);
});

export const favoriteCardsV1 = httpAction((ctx, request) => {
  if (request.method !== "GET") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCardsQueryRequest(ctx, request, true);
});

export const cardByIdV1 = httpAction((ctx, request) => {
  if (
    !(
      request.method === "DELETE" ||
      request.method === "GET" ||
      request.method === "PATCH"
    )
  ) {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCardsByIdV1Request(ctx, request);
});

export const bulkCardsV1 = httpAction((ctx, request) => {
  if (request.method !== "POST") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleBulkCardsRequest(ctx, request);
});

export const changesCardsV1 = httpAction((ctx, request) => {
  if (request.method !== "GET") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCardChangesRequest(ctx, request);
});

export const tagsV1 = httpAction((ctx, request) => {
  if (request.method !== "GET") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleTagsRequest(ctx, request);
});
