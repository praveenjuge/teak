import { env } from "./_generated/server";
import type { CardLinks } from "./card/cardLinks";
import type { CardWithUrls } from "./card/queryUtils";
import { narrowTypesForQuery } from "./card/searchPlanner";
import { normalizeVisualFilterArgs } from "./card/visualFilters";
import { isLocalDevelopmentHostname, resolveTeakDevAppUrl } from "./devUrls";
import { readIsDevDeployment } from "./env";
import {
  ARCHIVED_FILTERS,
  CARD_SORTS,
  CARD_TYPES,
  type CardListInclude,
  type CardsQueryOptions,
  type CreateCardPayload,
  type CreateUploadPayload,
  errorResponse,
  explainCardTypeMismatch,
  explainInvalidTags,
  parseBooleanQuery,
  parseLimit,
  parseOptionalNullableString,
  parseOptionalString,
  parseStringArray,
  parseTimestampQuery,
  truncateCardTitle,
} from "./publicApiHttpShared";
import type { CardType } from "./schema";
import {
  explainInvalidCardSource,
  normalizeCardSource,
} from "./shared/cardSource";
import { parseCardTitle } from "./shared/cardTitle";
import {
  normalizeColorHueBucket,
  normalizeVisualStyle,
} from "./shared/constants";
import {
  explainInvalidFolderName,
  FOLDER_COLORS,
  type FolderColor,
  type FolderKind,
  isFolderColor,
  MAX_FOLDER_CARD_IDS,
  MAX_FOLDERS_PER_CARD,
} from "./shared/folders";
import { isLinkPrice } from "./shared/price";
import { SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION } from "./shared/search/constants";
import {
  combineSearchQueries,
  hasSearchQualifiers,
  parseSearchQuery,
} from "./shared/search/qualifiers";
import { isSearchMode, semanticRequestFor } from "./shared/search/semantic";
import { parseShuffleSeed } from "./shared/search/shuffle";
import { isCardHidden } from "./shared/tags";
import { isSafeExternalUrl } from "./shared/utils/safeUrl";

const APP_PROD_URL = "https://app.teakvault.com";

const getAppBaseUrl = (requestUrl: string): string => {
  const { hostname } = new URL(requestUrl);
  return isLocalDevelopmentHostname(hostname) || readIsDevDeployment()
    ? resolveTeakDevAppUrl(env)
    : APP_PROD_URL;
};

const getCardAppUrl = (requestUrl: string, cardId: string): string => {
  const appUrl = new URL(getAppBaseUrl(requestUrl));
  appUrl.searchParams.set("card", cardId);
  return appUrl.toString();
};

const serializeLinkPrice = (price: unknown) =>
  isLinkPrice(price)
    ? { amount: price.amount, currency: price.currency ?? null }
    : null;

const serializeDisplayMetadata = (card: CardWithUrls) => ({
  audioWaveform: card.fileMetadata?.waveform ?? null,
  isDeleted: Boolean(card.isDeleted),
  linkPreviewDescription: card.metadata?.linkPreview?.description ?? null,
  linkFacts:
    card.metadata?.linkCategory?.facts?.map(
      (fact: { label: string; value: string }) => ({
        label: fact.label,
        value: fact.value,
      })
    ) ?? [],
  linkPreviewTitle: card.metadata?.linkPreview?.title ?? null,
  linkCategory: card.metadata?.linkCategory?.category ?? null,
  linkPrice: serializeLinkPrice(card.metadata?.linkCategory?.price),
  linkFaviconUrl: card.metadata?.linkPreview?.faviconUrl ?? null,
  fileWidth: card.fileMetadata?.width ?? null,
  fileHeight: card.fileMetadata?.height ?? null,
  colors:
    card.colors?.map((color: { hex: string; name?: string }) => ({
      hex: color.hex,
      ...(color.name ? { name: color.name } : {}),
    })) ?? [],
  linkAuthor: card.metadata?.linkPreview?.author ?? null,
  linkPreviewMedia: card.linkPreviewMedia ?? [],
  linkPublishedAt: card.metadata?.linkPreview?.publishedAt ?? null,
  linkPublisher: card.metadata?.linkPreview?.publisher ?? null,
  linkSiteName: card.metadata?.linkPreview?.siteName ?? null,
  videoScrub:
    card.scrubUrl && card.fileMetadata?.scrub
      ? {
          frameHeight: card.fileMetadata.scrub.frameHeight,
          frameWidth: card.fileMetadata.scrub.frameWidth,
          frames: card.fileMetadata.scrub.frames,
          url: card.scrubUrl,
        }
      : null,
});

/**
 * A card as the public API returns it. `links` (its `[[…]]` links and the
 * cards linking to it) is given only for single-card responses; lists and
 * the changes feed leave both arrays out.
 */
const serializeCard = (
  card: CardWithUrls,
  requestUrl: string,
  links?: CardLinks
) => ({
  aiSummary: card.aiSummary ?? null,
  aiTags: card.aiTags ?? [],
  aiTranscript: card.aiTranscript ?? null,
  appUrl: getCardAppUrl(requestUrl, card._id),
  compactUrl: card.compactUrl ?? null,
  content: card.content,
  ...serializeDisplayMetadata(card),
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
  archivedAt: card.archivedAt ?? null,
  completedAt: card.completedAt ?? null,
  folderIds: card.folderIds ?? [],
  isArchived: Boolean(card.isArchived),
  isFavorited: Boolean(card.isFavorited),
  isHidden: isCardHidden(card),
  linkPreviewImageUrl: card.linkPreviewImageUrl ?? null,
  metadataDescription: card.metadataDescription ?? null,
  metadataStatus: card.metadataStatus ?? null,
  metadataTitle: card.metadataTitle ?? null,
  mimeType: card.fileMetadata?.mimeType ?? null,
  notes: card.notes ?? null,
  processingStatus: card.processingStatus ?? null,
  screenshotUrl: card.screenshotUrl ?? null,
  sourceTitle: card.sourceTitle ?? null,
  sourceUrl: card.sourceUrl ?? null,
  tags: card.tags ?? [],
  placeholderUrl: card.placeholderUrl ?? null,
  thumbnailUrl: card.thumbnailUrl ?? null,
  thumbnailOverridden: Boolean(card.thumbnailOverride),
  type: card.type,
  updatedAt: card.updatedAt,
  url: card.url ?? null,
  ...(links ?? {}),
});

const serializeListCard = (
  card: CardWithUrls,
  requestUrl: string,
  include: Set<CardListInclude>
) => {
  const base = {
    aiTags: card.aiTags ?? [],
    appUrl: getCardAppUrl(requestUrl, card._id),
    completedAt: card.completedAt ?? null,
    createdAt: card.createdAt,
    folderIds: card.folderIds ?? [],
    id: card._id,
    isArchived: Boolean(card.isArchived),
    isFavorited: Boolean(card.isFavorited),
    isHidden: isCardHidden(card),
    metadataDescription: card.metadataDescription ?? null,
    metadataTitle: card.metadataTitle ?? null,
    sourceTitle: card.sourceTitle ?? null,
    sourceUrl: card.sourceUrl ?? null,
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
          ...serializeDisplayMetadata(card),
          compactUrl: card.compactUrl ?? null,
          detailUrl: card.detailUrl ?? null,
          fileUrl: card.fileUrl ?? null,
          linkPreviewImageUrl: card.linkPreviewImageUrl ?? null,
          placeholderUrl: card.placeholderUrl ?? null,
          screenshotUrl: card.screenshotUrl ?? null,
          thumbnailOverridden: Boolean(card.thumbnailOverride),
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

type CreatePayloadResult = { error: string } | { payload: CreateCardPayload };

const CREATE_KEYS = new Set([
  "cardType",
  "content",
  "fileEtag",
  "fileKey",
  "fileName",
  "fileSize",
  "mimeType",
  "notes",
  "source",
  "sourceTitle",
  "sourceUrl",
  "tags",
  "url",
]);

const CREATE_STRING_KEYS = [
  "cardType",
  "content",
  "fileEtag",
  "fileKey",
  "fileName",
  "mimeType",
  "source",
  "sourceTitle",
  "sourceUrl",
  "url",
] as const;

const parseCreatePayload = (payload: unknown): CreatePayloadResult => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Body must be a JSON object" };
  }

  const source = payload as Record<string, unknown>;
  const unknownKey = Object.keys(source).find((key) => !CREATE_KEYS.has(key));
  if (unknownKey !== undefined) {
    return { error: `Unknown field \`${unknownKey}\`` };
  }

  const wrongTypeKey = CREATE_STRING_KEYS.find(
    (key) => source[key] !== undefined && typeof source[key] !== "string"
  );
  if (wrongTypeKey !== undefined) {
    return { error: `\`${wrongTypeKey}\` must be a string` };
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
  const cardSource = {
    sourceTitle: source.sourceTitle as string | undefined,
    sourceUrl: source.sourceUrl as string | undefined,
  };
  const tags =
    source.tags === undefined ? undefined : parseStringArray(source.tags);

  if (source.tags !== undefined && tags === undefined) {
    return { error: "`tags` must be an array of strings" };
  }
  const tagError = explainInvalidTags(tags);
  if (tagError) {
    return { error: tagError };
  }
  if (url !== undefined && !isSafeExternalUrl(url)) {
    return { error: "`url` must use the http or https scheme" };
  }
  const sourceError = explainInvalidCardSource(cardSource);
  if (sourceError) {
    return { error: sourceError };
  }
  if (cardType !== undefined && !CARD_TYPES.has(cardType)) {
    return {
      error: `\`cardType\` must be one of: ${[...CARD_TYPES].join(", ")}`,
    };
  }
  if (
    source.fileSize !== undefined &&
    !(typeof source.fileSize === "number" && Number.isFinite(source.fileSize))
  ) {
    return { error: "`fileSize` must be a number" };
  }
  const fileSize = source.fileSize as number | undefined;

  if (
    source.notes !== undefined &&
    !(typeof source.notes === "string" || source.notes === null)
  ) {
    return { error: "`notes` must be a string or null" };
  }

  if (fileKey) {
    if (!(fileName && mimeType)) {
      return { error: "An uploaded file needs `fileName` and `mimeType`" };
    }
    if (url) {
      return { error: "Send either `fileKey` or `url`, not both" };
    }
    if (cardSource.sourceUrl !== undefined) {
      return { error: "`sourceUrl` can't be sent with an uploaded `fileKey`" };
    }
    return {
      payload: {
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
      },
    };
  }

  if (fileName || mimeType) {
    return { error: "`fileName` and `mimeType` need an uploaded `fileKey`" };
  }
  if (content === undefined && !url) {
    return { error: "Body must include `content` or `url`" };
  }
  if (cardType !== "text" && !url && !content?.trim()) {
    return {
      error: "`content` cannot be blank unless `cardType` is `text`",
    };
  }
  const typeError = explainCardTypeMismatch({ cardType, content, notes, tags });
  if (typeError) {
    return { error: typeError };
  }

  return {
    payload: {
      cardType,
      content,
      notes,
      source: sourceValue,
      ...normalizeCardSource(cardSource),
      tags,
      url,
    },
  };
};

const validateCreatePayload = (payload: unknown): CreateCardPayload | null => {
  const result = parseCreatePayload(payload);
  return "payload" in result ? result.payload : null;
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
  const similarTo = parseOptionalString(searchParams.get("similarTo"));
  if (
    searchParams.has("similarTo") &&
    !(similarTo && parseSearchQuery(`like:${similarTo}`).similarity)
  ) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `similarTo` must be a card id"
    );
  }
  const typedQuery = parseOptionalString(searchParams.get("q"));
  const combinedQuery = similarTo
    ? combineSearchQueries(`like:${similarTo}`, typedQuery ?? "")
    : typedQuery;
  const query = combinedQuery ?? undefined;
  const types = searchParams
    .getAll("type")
    .map((value) => value.trim())
    .filter(Boolean);
  const uniqueTypes = [...new Set(types)];
  const tag = parseOptionalString(searchParams.get("tag"));
  const sort = parseOptionalString(searchParams.get("sort"));
  const createdAfter = parseTimestampQuery(searchParams.get("createdAfter"));
  const createdBefore = parseTimestampQuery(searchParams.get("createdBefore"));
  const favorited = parseBooleanQuery(searchParams.get("favorited"));
  const trashed = parseBooleanQuery(searchParams.get("trashed"));
  if (searchParams.has("trashed") && trashed === undefined) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `trashed` must be `true` or `false`"
    );
  }
  const archived = parseOptionalString(searchParams.get("archived"));
  if (
    searchParams.has("archived") &&
    !(archived && ARCHIVED_FILTERS.has(archived))
  ) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `archived` must be `exclude`, `only` or `include`"
    );
  }
  for (const dimension of ["style", "hue", "hex"]) {
    if (
      searchParams.getAll(dimension).length >
      SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION
    ) {
      return errorResponse(
        400,
        "INVALID_INPUT",
        `Query parameter \`${dimension}\` accepts at most ${SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION} filters`
      );
    }
  }
  let visualFilters: ReturnType<typeof normalizeVisualFilterArgs>;
  try {
    visualFilters = normalizeVisualFilterArgs({
      styleFilters: searchParams.getAll("style"),
      hueFilters: searchParams.getAll("hue"),
      hexFilters: searchParams.getAll("hex"),
    });
    for (const [name, normalize] of [
      ["style", normalizeVisualStyle],
      ["hue", normalizeColorHueBucket],
    ] as const) {
      if (searchParams.getAll(name).some((value) => !normalize(value))) {
        return errorResponse(
          400,
          "INVALID_INPUT",
          `Query parameter \`${name}\` is invalid`
        );
      }
    }
  } catch {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `hex` is invalid"
    );
  }

  if (uniqueTypes.some((type) => !CARD_TYPES.has(type))) {
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
      "Query parameter `sort` must be `newest`, `oldest`, `relevance` or `shuffle`"
    );
  }

  const mode = parseOptionalString(searchParams.get("mode")) ?? "hybrid";
  if (!isSearchMode(mode)) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `mode` must be `hybrid`, `keyword` or `semantic`"
    );
  }

  const shuffleSeed = parseShuffleSeed(searchParams.get("shuffleSeed"));
  if (sort === "shuffle" && shuffleSeed === undefined) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `shuffleSeed` is required with `sort=shuffle` and must be a whole number from 0 to 2147483647"
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

  const folder = parseOptionalString(searchParams.get("folder"));
  if (searchParams.has("folder") && !(folder && folder.length <= 64)) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `folder` must be a folder id"
    );
  }

  const parsed = parseSearchQuery(query ?? "");
  // Every requested type was checked against CARD_TYPES above.
  const narrowedTypes = narrowTypesForQuery(parsed, uniqueTypes as CardType[]);
  const resolvedTypes: string[] = narrowedTypes ?? [];
  let matchesNothing = narrowedTypes === null;
  matchesNothing ||= combinedQuery === null;
  let resolvedArchived = archived as CardsQueryOptions["archived"];
  if (parsed.archived && trashed !== true) {
    matchesNothing ||= archived === "exclude";
    resolvedArchived = "only";
  }
  const tags = [
    ...new Set(
      [tag, ...parsed.tags]
        .map((value) => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value))
    ),
  ];

  return {
    createdAfter,
    createdBefore,
    cursor: parseOptionalString(searchParams.get("cursor")),
    archived: resolvedArchived,
    folder,
    favoritesOnly: favorited === true || parsed.favorite,
    ...(matchesNothing ? { matchesNothing } : {}),
    ...(hasSearchQualifiers(parsed) || parsed.phrases.length > 0
      ? {
          qualifiers: {
            archivedInTrash: trashed === true && parsed.archived,
            ...(parsed.done ? { done: true } : {}),
            folderNames: parsed.folders,
            ...(parsed.ocrTexts.length > 0
              ? { ocrTexts: parsed.ocrTexts }
              : {}),
            phrases: parsed.phrases,
            prices: parsed.prices,
            sites: parsed.sites,
            tags: tags.slice(1),
            ...(parsed.todo ? { todo: true } : {}),
          },
        }
      : {}),
    showTrashOnly: trashed === true,
    styleFilters: visualFilters.styleFilters,
    hueFilters: visualFilters.hueFilters,
    hexFilters: visualFilters.hexFilters,
    limit: parseLimit(searchParams.get("limit")),
    hasQuery: Boolean(query),
    mode,
    searchQuery: parsed.text || undefined,
    semantic: semanticRequestFor(parsed),
    similarity: parsed.similarity ?? null,
    sort: sort as CardsQueryOptions["sort"] | undefined,
    ...(sort === "shuffle" ? { shuffleSeed } : {}),
    tag: tags[0],
    type: resolvedTypes.length === 1 ? resolvedTypes[0] : undefined,
    types: resolvedTypes.length > 1 ? resolvedTypes : undefined,
  };
};

const buildCreateCardResponse = (
  result: { card?: CardWithUrls; cardId: string; status: "created" },
  requestUrl: string,
  links?: CardLinks
) => {
  const card = result.card
    ? serializeCard(result.card, requestUrl, links)
    : undefined;
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
  operation:
    | "content"
    | "delete"
    | "done"
    | "favorite"
    | "get"
    | "patch"
    | "refresh"
    | "restore"
    | "save-pdf"
    | "thumbnail-reset"
    | "thumbnail-set"
    | "thumbnail-upload"
    | "undone";
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

  if (
    request.method === "GET" &&
    segments.length === 4 &&
    segments[3] === "content"
  ) {
    return { cardId, operation: "content" };
  }

  if (request.method === "DELETE" && segments.length === 3) {
    return { cardId, operation: "delete" };
  }

  if (segments.length === 4 && segments[3] === "done") {
    if (request.method === "POST") {
      return { cardId, operation: "done" };
    }
    if (request.method === "DELETE") {
      return { cardId, operation: "undone" };
    }
    return null;
  }

  if (segments.length === 4 && segments[3] === "thumbnail") {
    if (request.method === "PUT") {
      return { cardId, operation: "thumbnail-set" };
    }
    if (request.method === "DELETE") {
      return { cardId, operation: "thumbnail-reset" };
    }
    return null;
  }

  if (
    request.method === "POST" &&
    segments.length === 5 &&
    segments[3] === "thumbnail" &&
    segments[4] === "upload"
  ) {
    return { cardId, operation: "thumbnail-upload" };
  }

  if (
    request.method === "POST" &&
    segments.length === 4 &&
    segments[3] === "restore"
  ) {
    return { cardId, operation: "restore" };
  }

  if (
    request.method === "POST" &&
    segments.length === 4 &&
    segments[3] === "refresh"
  ) {
    return { cardId, operation: "refresh" };
  }

  if (
    request.method === "POST" &&
    segments.length === 4 &&
    segments[3] === "save-pdf"
  ) {
    return { cardId, operation: "save-pdf" };
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

interface PatchCardPayload {
  content?: string;
  folderIds?: string[];
  isArchived?: boolean;
  metadataTitle?: string | null;
  notes?: string | null;
  removeAiTags?: string[];
  tags?: string[];
  url?: string;
}

const validatePatchPayload = (payload: unknown): PatchCardPayload | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const source = payload as Record<string, unknown>;
  const allowedKeys = new Set([
    "content",
    "folderIds",
    "isArchived",
    "metadataTitle",
    "notes",
    "removeAiTags",
    "tags",
    "url",
  ]);

  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) {
      return null;
    }
  }

  const next: PatchCardPayload = {};

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

  if ("metadataTitle" in source) {
    const parsed = parseCardTitle(truncateCardTitle(source.metadataTitle));
    if (parsed.kind === "invalid") {
      return null;
    }
    next.metadataTitle = parsed.kind === "title" ? parsed.title : null;
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
    if (tags === undefined || explainInvalidTags(tags)) {
      return null;
    }
    next.tags = tags;
  }

  if ("removeAiTags" in source) {
    const removeAiTags = parseStringArray(source.removeAiTags);
    if (!removeAiTags?.length) {
      return null;
    }
    next.removeAiTags = removeAiTags;
  }

  if ("isArchived" in source) {
    if (typeof source.isArchived !== "boolean") {
      return null;
    }
    next.isArchived = source.isArchived;
  }

  if ("folderIds" in source) {
    const folderIds = parseStringArray(source.folderIds);
    if (
      folderIds === undefined ||
      folderIds.length > MAX_FOLDERS_PER_CARD ||
      folderIds.some((id) => id.length > 64)
    ) {
      return null;
    }
    next.folderIds = folderIds;
  }

  if (Object.keys(next).length === 0) {
    return null;
  }

  return next;
};

const validateThumbnailUploadPayload = (
  payload: unknown
): { fileSize: number; mimeType: string } | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const source = payload as Record<string, unknown>;
  if (
    Object.keys(source).some((key) => key !== "fileSize" && key !== "mimeType")
  ) {
    return null;
  }
  const mimeType = parseOptionalString(source.mimeType);
  const fileSize = source.fileSize;
  return mimeType && typeof fileSize === "number"
    ? { fileSize, mimeType }
    : null;
};

const validateThumbnailSetPayload = (
  payload: unknown
): { fileKey: string } | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const source = payload as Record<string, unknown>;
  const fileKey = parseOptionalString(source.fileKey);
  return Object.keys(source).length === 1 && fileKey ? { fileKey } : null;
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

const serializeFolder = (folder: {
  _id: string;
  activeCardCount: number;
  color?: string;
  createdAt: number;
  kind: string;
  name: string;
  query?: string;
  updatedAt: number;
}) => ({
  id: folder._id,
  name: folder.name,
  color: folder.color ?? null,
  kind: folder.kind,
  query: folder.kind === "smart" ? (folder.query ?? "") : null,
  cardCount: folder.kind === "smart" ? null : folder.activeCardCount,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
});

const parseFolderRoute = (
  request: Request
): { folderId: string; cards: boolean } | null => {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  if (segments[0] !== "v1" || segments[1] !== "folders" || !segments[2]) {
    return null;
  }
  if (segments.length === 3) {
    return { folderId: segments[2], cards: false };
  }
  if (segments.length === 4 && segments[3] === "cards") {
    return { folderId: segments[2], cards: true };
  }
  return null;
};

type FolderPayload =
  | {
      payload: {
        color?: FolderColor | null;
        kind?: FolderKind;
        name?: string;
        query?: string;
      };
    }
  | { error: string };

const parseFolderPayload = (
  payload: unknown,
  mode: "create" | "update"
): FolderPayload => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Body must be a JSON object" };
  }
  const source = payload as Record<string, unknown>;
  const allowed =
    mode === "create"
      ? ["name", "color", "kind", "query"]
      : ["name", "color", "query"];
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) {
      return {
        error: `Body may include only ${allowed.map((name) => `\`${name}\``).join(", ")}`,
      };
    }
  }
  const next: {
    color?: FolderColor | null;
    kind?: FolderKind;
    name?: string;
    query?: string;
  } = {};
  if ("name" in source) {
    if (typeof source.name !== "string") {
      return { error: "`name` must be a string" };
    }
    const reason = explainInvalidFolderName(source.name);
    if (reason) {
      return { error: reason };
    }
    next.name = source.name;
  } else if (mode === "create") {
    return { error: "Body must include `name`" };
  }
  if ("color" in source) {
    if (source.color === null && mode === "update") {
      next.color = null;
    } else if (isFolderColor(source.color)) {
      next.color = source.color;
    } else {
      return {
        error: `\`color\` must be one of: ${FOLDER_COLORS.join(", ")}${mode === "update" ? ", or null" : ""}`,
      };
    }
  }
  if ("kind" in source) {
    if (source.kind !== "manual" && source.kind !== "smart") {
      return { error: "`kind` must be `manual` or `smart`" };
    }
    next.kind = source.kind;
  }
  if ("query" in source) {
    if (typeof source.query !== "string") {
      return { error: "`query` must be a string" };
    }
    next.query = source.query;
  }
  if (mode === "create") {
    if (next.kind === "smart" && next.query === undefined) {
      return { error: "A smart folder needs a `query`" };
    }
    if (next.kind !== "smart" && next.query !== undefined) {
      return { error: '`query` needs `kind: "smart"`' };
    }
  }
  if (mode === "update" && Object.keys(next).length === 0) {
    return { error: "Body must include `name`, `color` or `query`" };
  }
  return { payload: next };
};

const parseFolderCardsPayload = (
  payload: unknown
): { cardIds: string[] } | { error: string } => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Body must be a JSON object with `cardIds`" };
  }
  const source = payload as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== "cardIds")) {
    return { error: "Body may include only `cardIds`" };
  }
  const cardIds = parseStringArray(source.cardIds);
  if (!cardIds?.length) {
    return { error: "`cardIds` must be a non-empty array of card ids" };
  }
  if (cardIds.length > MAX_FOLDER_CARD_IDS) {
    return {
      error: `\`cardIds\` may name at most ${MAX_FOLDER_CARD_IDS} cards`,
    };
  }
  if (cardIds.some((id) => id.length > 64)) {
    return { error: "`cardIds` must contain card ids" };
  }
  return { cardIds };
};

export {
  buildCreateCardResponse,
  getAppBaseUrl,
  parseCardRoute,
  parseCardsQueryOptions,
  parseCreatePayload,
  parseFolderCardsPayload,
  parseFolderPayload,
  parseFolderRoute,
  parseIncludeSet,
  serializeCard,
  serializeFolder,
  serializeListCard,
  validateCreatePayload,
  validateFavoritePayload,
  validatePatchPayload,
  validateThumbnailSetPayload,
  validateThumbnailUploadPayload,
  validateUploadPayload,
};
