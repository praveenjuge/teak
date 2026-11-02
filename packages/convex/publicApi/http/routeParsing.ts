import { narrowTypesForQuery } from "../../card/searchPlanner";
import { normalizeVisualFilterArgs } from "../../card/visualFilters";
import type { CardType } from "../../schema";
import {
  normalizeColorHueBucket,
  normalizeVisualStyle,
} from "../../shared/constants";
import { SEARCH_MAX_VISUAL_FILTERS_PER_DIMENSION } from "../../shared/search/constants";
import { expressionWantsArchived } from "../../shared/search/expression";
import {
  combineSearchQueries,
  formatSearchExpression,
  hasSearchQualifiers,
  parseSearchQuery,
} from "../../shared/search/qualifiers";
import { isSearchMode, semanticRequestFor } from "../../shared/search/semantic";
import { parseShuffleSeed } from "../../shared/search/shuffle";
import {
  ARCHIVED_FILTERS,
  CARD_SORTS,
  CARD_TYPES,
  type CardListInclude,
  type CardsQueryOptions,
  errorResponse,
  parseBooleanQuery,
  parseLimit,
  parseOptionalString,
  parseTimestampQuery,
} from "./shared";

export const parseIncludeSet = (
  value: string | null
): Set<CardListInclude> | null => {
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

export const parseCardsQueryOptions = (
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
  const pinned = parseBooleanQuery(searchParams.get("pinned"));
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

  if (searchParams.has("pinned") && pinned === undefined) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `pinned` must be `true` or `false`"
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
  } else if (
    resolvedArchived === undefined &&
    trashed !== true &&
    expressionWantsArchived(parsed.expression)
  ) {
    // `is:archived` inside an OR reads archived cards too, unless the caller
    // set `archived` itself.
    resolvedArchived = "include";
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
    pinnedOnly: pinned === true || parsed.pinned,
    ...(matchesNothing ? { matchesNothing } : {}),
    ...(hasSearchQualifiers(parsed) ||
    parsed.phrases.length > 0 ||
    parsed.expression
      ? {
          qualifiers: {
            archivedInTrash: trashed === true && parsed.archived,
            ...(parsed.done ? { done: true } : {}),
            ...(parsed.expression
              ? { expression: formatSearchExpression(parsed.expression) }
              : {}),
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

export const parseCardRoute = (
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
    | "pin"
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

  if (segments.length === 4 && segments[3] === "pin") {
    return { cardId, operation: "pin" };
  }

  return null;
};

export const parseFolderRoute = (
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
