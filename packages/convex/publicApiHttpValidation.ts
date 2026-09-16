/**
 * Public API request validation and response serialization: payload
 * validators, query-option parsing, and card serializers.
 * Split out of `publicApiHttp.ts`, kept behavior-identical.
 */
import { env } from "./_generated/server";
import { isLocalDevelopmentHostname, resolveTeakDevAppUrl } from "./devUrls";
import {
  CARD_SORTS,
  CARD_TYPES,
  type CardListInclude,
  type CardsQueryOptions,
  type CreateCardPayload,
  type CreateUploadPayload,
  errorResponse,
  parseBooleanQuery,
  parseLimit,
  parseOptionalNullableString,
  parseOptionalString,
  parseStringArray,
  parseTimestampQuery,
} from "./publicApiHttpShared";
import { isSafeExternalUrl } from "./shared/utils/safeUrl";

const APP_PROD_URL = "https://app.teakvault.com";
const APP_DEV_URL = resolveTeakDevAppUrl(env);

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
  compactUrl: card.compactUrl ?? null,
  content: card.content,
  createdAt: card.createdAt,
  detailUrl: card.detailUrl ?? null,
  fileUrl: card.fileUrl ?? null,
  fileExtension: card.fileMetadata?.extension ?? null,
  fileKind: card.fileMetadata?.kind ?? null,
  fileLanguage: card.fileMetadata?.language ?? null,
  fileName: card.fileMetadata?.fileName ?? null,
  filePreview: card.fileMetadata?.preview ?? null,
  fileSize: card.fileMetadata?.fileSize ?? null,
  id: card._id,
  isFavorited: Boolean(card.isFavorited),
  linkPreviewImageUrl: card.linkPreviewImageUrl ?? null,
  metadataDescription: card.metadataDescription ?? null,
  metadataTitle: card.metadataTitle ?? null,
  mimeType: card.fileMetadata?.mimeType ?? null,
  notes: card.notes ?? null,
  screenshotUrl: card.screenshotUrl ?? null,
  tags: card.tags ?? [],
  placeholderUrl: card.placeholderUrl ?? null,
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
          fileName: card.fileMetadata?.fileName ?? null,
          fileSize: card.fileMetadata?.fileSize ?? null,
          mimeType: card.fileMetadata?.mimeType ?? null,
          fileExtension: card.fileMetadata?.extension ?? null,
          fileKind: card.fileMetadata?.kind ?? null,
          fileLanguage: card.fileMetadata?.language ?? null,
          filePreview: card.fileMetadata?.preview ?? null,
          compactUrl: card.compactUrl ?? null,
          detailUrl: card.detailUrl ?? null,
          fileUrl: card.fileUrl ?? null,
          linkPreviewImageUrl: card.linkPreviewImageUrl ?? null,
          placeholderUrl: card.placeholderUrl ?? null,
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
    "fileEtag",
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

  // Reject supplied string fields with the wrong type instead of silently
  // dropping them (notes/tags/fileSize already guard their own shapes below).
  const optionalStringKeys = [
    "cardType",
    "content",
    "fileEtag",
    "fileKey",
    "fileName",
    "mimeType",
    "source",
    "url",
  ] as const;

  for (const key of optionalStringKeys) {
    const value = source[key];
    if (value !== undefined && typeof value !== "string") {
      return null;
    }
  }

  const content =
    typeof source.content === "string" ? source.content : undefined;
  const url = parseOptionalString(source.url);
  const fileKey = parseOptionalString(source.fileKey);
  const fileEtag = parseOptionalString(source.fileEtag);
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
    if (!(fileName && mimeType) || url) {
      return null;
    }
    return {
      cardType,
      content,
      fileEtag,
      fileKey,
      fileName,
      fileSize,
      mimeType,
      notes,
      source: sourceValue,
      tags,
    };
  }

  if (content === undefined && !url) {
    return null;
  }
  if (cardType !== "text" && !url && !content?.trim()) {
    return null;
  }
  if (fileName || mimeType) {
    return null;
  }

  return {
    cardType,
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

const parseCardsQueryOptions = (
  request: Request
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
    favoritesOnly: favorited === true,
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
    if (typeof source.content !== "string") {
      return null;
    }
    next.content = source.content;
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

export {
  buildCreateCardResponse,
  parseCardRoute,
  parseCardsQueryOptions,
  parseIncludeSet,
  serializeCard,
  serializeListCard,
  validateCreatePayload,
  validateFavoritePayload,
  validatePatchPayload,
  validateUploadPayload,
};
