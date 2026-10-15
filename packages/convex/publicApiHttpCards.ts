/**
 * Public API route handlers: every /v1 endpoint implementation.
 * Split out of `publicApiHttp.ts`, kept behavior-identical.
 */

import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { readDocumentText } from "./card/documentText";
import {
  completeIdempotencyResponse,
  type IdempotencyState,
  maybeHandleIdempotency,
  releaseIdempotencyResponse,
  withAuthorizedUser,
} from "./publicApiHttpAuth";
import {
  errorResponse,
  json,
  MAX_BULK_ITEMS,
  MAX_LIMIT,
  MAX_QUERY_SCAN,
  mapConvexErrorToResponse,
  parseJsonBody,
  parseLimit,
  parseOptionalString,
  parseTimestampQuery,
} from "./publicApiHttpShared";
import {
  buildCreateCardResponse,
  parseCardRoute,
  parseCardsQueryOptions,
  parseCreatePayload,
  parseIncludeSet,
  serializeCard,
  serializeListCard,
  validateFavoritePayload,
  validatePatchPayload,
  validateUploadPayload,
} from "./publicApiHttpValidation";
import { fetchSemanticRanking } from "./search/semanticActions";
import { combineSearchQueries } from "./shared/search/qualifiers";

// A shuffled page reads at most this many times to fill up.
const MAX_SHUFFLE_READS = 4;

import type { WorkosResource } from "./workosTokens";

const handleCreateCardRequest = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(request);
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const parsedCreate = parseCreatePayload(payload);
  if ("error" in parsedCreate) {
    return errorResponse(400, "INVALID_INPUT", parsedCreate.error);
  }
  const createPayload = parsedCreate.payload;

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

    const result = createPayload.fileKey
      ? await ctx
          .runAction(
            (internal as any)["card/uploadCardAction"]
              .finalizeUploadedCardForUser,
            {
              cardType: createPayload.cardType,
              content: createPayload.content,
              fileEtag: createPayload.fileEtag,
              fileKey: createPayload.fileKey,
              fileName: createPayload.fileName,
              fileSize: createPayload.fileSize,
              fileType: createPayload.mimeType,
              notes:
                createPayload.notes === null ? undefined : createPayload.notes,
              tags: createPayload.tags,
              userId: auth.validated.userId,
            }
          )
          .then((uploaded: { cardId?: string; success: boolean }) => {
            if (!(uploaded.success && uploaded.cardId)) {
              throw new ConvexError({
                code: "INVALID_INPUT",
                message: "Uploaded file could not be finalized",
              });
            }
            return {
              cardId: uploaded.cardId,
              status: "created" as const,
            };
          })
      : await ctx.runMutation((internal as any).raycast.quickSaveForUser, {
          cardType: createPayload.cardType,
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
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request, { resource });
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

const handleCardsListRequest = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }

  let options = parseCardsQueryOptions(request);
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
    let folderId: string | undefined;
    if (options.folder) {
      const folder = await ctx.runQuery(
        internal.publicApiFolders.getFolderForApi,
        { userId: auth.validated.userId, folderId: options.folder }
      );
      if (!folder) {
        return errorResponse(404, "NOT_FOUND", "Folder not found");
      }
      if (folder.kind === "smart") {
        // A smart folder lists what its search matches: its search joins
        // `q` (both must match) and the folder drops out of the request.
        const url = new URL(request.url);
        const combined = combineSearchQueries(
          folder.query ?? "",
          url.searchParams.get("q") ?? ""
        );
        if (combined === null) {
          return json(200, {
            items: [],
            pageInfo: { hasMore: false, nextCursor: null },
          });
        }
        url.searchParams.set("q", combined);
        url.searchParams.delete("folder");
        const smartOptions = parseCardsQueryOptions(new Request(url));
        if (smartOptions instanceof Response) {
          return smartOptions;
        }
        options = smartOptions;
      } else {
        folderId = folder._id;
      }
    }
    // After the folder check, so an unknown folder is a 404 whatever else
    // the request asks for.
    if (options.matchesNothing) {
      return json(200, {
        items: [],
        pageInfo: { hasMore: false, nextCursor: null },
      });
    }
    // The meaning side first: queries cannot call the vector service. Down,
    // slow or rate-limited, the search is keyword-only and says so.
    const semantic =
      options.searchQuery && options.mode !== "keyword"
        ? await fetchSemanticRanking(
            ctx,
            auth.validated.userId,
            options.semanticText
          )
        : null;
    const semanticRanking = semantic?.ranking ?? undefined;
    const queryArgs = {
      archived: options.archived,
      folderId,
      showTrashOnly: options.showTrashOnly,
      styleFilters: options.styleFilters,
      hueFilters: options.hueFilters,
      hexFilters: options.hexFilters,
      createdAfter: options.createdAfter,
      createdBefore: options.createdBefore,
      cursor: options.cursor,
      favorited: options.favoritesOnly ? true : undefined,
      sort: options.sort,
      type: options.type,
      types: options.types,
      userId: auth.validated.userId,
      ...options.qualifiers,
      ...(semanticRanking ? { semanticRanking, mode: options.mode } : {}),
    };
    let cardsPage: {
      items: any[];
      pageInfo: { hasMore: boolean; nextCursor: string | null };
    };

    if (options.sort === "shuffle" && options.shuffleSeed !== undefined) {
      // A shuffled page can end early (where the walk wraps, or after rows
      // a filter skipped); read on until it is full or the order ends.
      const items: any[] = [];
      let cursor = options.cursor;
      let hasMore = true;
      for (
        let read = 0;
        read < MAX_SHUFFLE_READS && items.length < options.limit && hasMore;
        read++
      ) {
        const page = await ctx.runQuery(
          (internal as any).publicApi.shuffleCardsPageForUser,
          {
            ...queryArgs,
            sort: undefined,
            cursor,
            limit: options.limit - items.length,
            searchQuery: options.searchQuery,
            shuffleSeed: options.shuffleSeed,
            tag: options.tag,
          }
        );
        items.push(...page.items);
        cursor = page.pageInfo.nextCursor ?? undefined;
        hasMore = page.pageInfo.hasMore;
      }
      cardsPage = {
        items,
        pageInfo: { hasMore, nextCursor: hasMore ? (cursor ?? null) : null },
      };
    } else if (options.searchQuery || options.tag) {
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
      ...(options.searchQuery
        ? { searchMode: semanticRanking ? options.mode : "keyword" }
        : {}),
    });
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to fetch cards");
  }
};

const resolveCardId = (
  ctx: ActionCtx,
  cardId: string
): Promise<string | null> =>
  ctx.runQuery((internal as any).raycast.resolveCardIdForUserRequest, {
    cardId,
  });

const ensureCardExistsForUser = (
  ctx: ActionCtx,
  userId: string,
  cardId: string,
  includeDeleted = false
): Promise<any | null> =>
  ctx
    .runQuery((internal as any).raycast.getCardForUser, {
      cardId,
      userId,
    })
    .then((card: any | null) =>
      card?.isDeleted && !includeDeleted ? null : card
    );

/**
 * A card's full stored text: the document text Teak extracted from its file
 * (read from R2), else its transcript, else a text or quote card's content.
 * If the stored document text can't be read, its searchable prefix is
 * returned rather than failing the request, marked truncated when it is
 * shorter than the stored text.
 */
const cardContentResponse = async (
  ctx: ActionCtx,
  userId: string,
  cardId: Id<"cards">
): Promise<Response> => {
  const source = await ctx.runQuery(
    (internal as any)["card/documentText"].getCardTextSource,
    { cardId, userId }
  );
  if (!source) {
    return errorResponse(404, "NO_CONTENT", "This card has no stored text");
  }
  let { text, truncated } = source;
  if (source.sourceKey) {
    try {
      text = await readDocumentText(source.sourceKey);
    } catch (error) {
      console.warn("[publicApi] stored document text unreadable", {
        cardId,
        message: error instanceof Error ? error.message : String(error),
      });
      // A short document's prefix is all of its text.
      truncated ||= Array.from(text).length < source.charCount;
    }
  }
  return json(200, {
    cardId: source.cardId,
    kind: source.kind,
    text,
    charCount: source.charCount,
    truncated,
  });
};

const handleCardsByIdV1Request = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const route = parseCardRoute(request);
  if (!route) {
    return errorResponse(404, "NOT_FOUND", "Card route not found");
  }

  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }

  const normalizedCardId = await resolveCardId(ctx, route.cardId);
  if (!normalizedCardId) {
    return errorResponse(404, "NOT_FOUND", "Card not found");
  }

  const permanent = new URL(request.url).searchParams.get("permanent");
  if (
    route.operation === "delete" &&
    permanent !== null &&
    !["true", "false"].includes(permanent)
  ) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `permanent` must be `true` or `false`"
    );
  }
  const currentCard = await ensureCardExistsForUser(
    ctx,
    auth.validated.userId,
    normalizedCardId,
    route.operation === "restore" ||
      route.operation === "refresh" ||
      (route.operation === "delete" && permanent === "true")
  );
  if (!currentCard) {
    return errorResponse(404, "NOT_FOUND", "Card not found");
  }

  if (route.operation === "get") {
    return json(200, serializeCard(currentCard, request.url));
  }

  if (route.operation === "content") {
    return await cardContentResponse(
      ctx,
      auth.validated.userId,
      normalizedCardId as Id<"cards">
    );
  }

  if (
    route.operation === "delete" &&
    permanent === "true" &&
    !currentCard.isDeleted
  ) {
    return errorResponse(
      409,
      "NOT_IN_TRASH",
      "Move the card to Trash before deleting it permanently"
    );
  }

  if (route.operation === "refresh") {
    try {
      const result = await ctx.runMutation(
        internal["card/updateCard"].reprocessCardForUser,
        {
          cardId: normalizedCardId as Id<"cards">,
          userId: auth.validated.userId,
        }
      );
      return json(202, {
        cardId: result.cardId,
        requestedAt: result.requestedAt,
        status: "queued",
      });
    } catch (error) {
      return mapConvexErrorToResponse(error, "Failed to refresh card");
    }
  }

  if (route.operation === "delete" || route.operation === "restore") {
    try {
      let mutation = internal.raycast.softDeleteCardForUser;
      if (route.operation === "restore") {
        mutation = internal["card/deleteCard"].restoreCardForUser;
      } else if (permanent === "true") {
        mutation = internal["card/deleteCard"].permanentDeleteCardForUser;
      }
      await ctx.runMutation(mutation, {
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
      return mapConvexErrorToResponse(
        error,
        route.operation === "restore"
          ? "Failed to restore card"
          : "Failed to delete card"
      );
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
        "Body must include at least one valid field: content, url, metadataTitle, notes, tags (each at most 64 characters), removeAiTags, isArchived, folderIds (at most 50)"
      );
    }
    if (
      patchPayload.content !== undefined &&
      currentCard.type !== "text" &&
      !patchPayload.content.trim()
    ) {
      return errorResponse(
        400,
        "INVALID_INPUT",
        "Text content cannot be empty for this card type"
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
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }

  try {
    const userId = auth.validated.userId;
    const tags = await ctx.runQuery(
      (internal as any).publicApi.listTagsForUser,
      { userId }
    );
    if (tags.isComplete) {
      return json(200, { items: tags.items, isComplete: true });
    }
    // Too many tags to count live: answer from the background tag summary,
    // which catches up a few seconds after tags change, and build it first
    // if the account has none yet.
    const summary = await ctx.runQuery(
      internal.tag.tagSummary.getTagSummaryForUser,
      { userId }
    );
    if (summary) {
      return json(200, {
        items: summary.items,
        isComplete: summary.isComplete,
      });
    }
    await ctx.runMutation(internal.tag.tagSummary.requestTagSummaryForUser, {
      userId,
    });
    return json(200, { items: tags.items, isComplete: false });
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to fetch tags");
  }
};

const handleCardChangesRequest = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request, { resource });
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
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to fetch card changes");
  }
};

const BULK_OPERATIONS = new Set([
  "create",
  "update",
  "favorite",
  "delete",
  "archive",
  "unarchive",
  "addTags",
  "removeTags",
  "restore",
]);

const handleBulkCardsRequest = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request, { resource });
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
  if (!(operation && items && BULK_OPERATIONS.has(operation))) {
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

  const hasPermanentFlag =
    "permanent" in source ||
    items.some(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        "permanent" in (item as Record<string, unknown>)
    );
  if (hasPermanentFlag) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Bulk operations do not support `permanent`. Use DELETE /v1/cards/:cardId?permanent=true for each card in Trash."
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

export {
  handleBulkCardsRequest,
  handleCardChangesRequest,
  handleCardsByIdV1Request,
  handleCardsListRequest,
  handleCreateCardRequest,
  handleCreateUploadRequest,
  handleTagsRequest,
};
