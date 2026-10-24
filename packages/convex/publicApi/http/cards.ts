import { ConvexError } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import { readDocumentText } from "../../card/documentText";
import type { CardWithUrls } from "../../card/queryUtils";
import { withTranscripts } from "../../card/textContents";
import {
  API_RELEVANCE_TIMEOUT_MS,
  ensureRelevanceScores,
} from "../../search/relevanceActions";
import { fetchSemanticRanking } from "../../search/semanticActions";
import { combineSearchQueries } from "../../shared/search/qualifiers";
import {
  RELEVANCE_CANDIDATE_LIMIT,
  type RelevanceScore,
} from "../../shared/search/relevance";
import { captureBackendEvent } from "../../telemetry/posthog";
import { relevanceCursorRanked } from "../cursors";
import {
  completeIdempotencyResponse,
  type IdempotencyState,
  maybeHandleIdempotency,
  releaseReservationKeepingOriginalError,
  withAuthorizedUser,
} from "./auth";
import {
  parseCreatePayload,
  validateFavoritePayload,
  validatePatchPayload,
  validateThumbnailSetPayload,
  validateThumbnailUploadPayload,
  validateUploadPayload,
} from "./payloads";
import {
  parseCardRoute,
  parseCardsQueryOptions,
  parseIncludeSet,
} from "./routeParsing";
import {
  buildCreateCardResponse,
  serializeCard,
  serializeListCard,
} from "./serializers";
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
} from "./shared";

const MAX_SHUFFLE_READS = 4;

import type { WorkosResource } from "../../workos/tokens";

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
            internal["card/uploadCardAction"].finalizeUploadedCardForUser,
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
      : await ctx.runMutation(
          internal.publicApi.cardsForUser.quickSaveForUser,
          {
            cardType: createPayload.cardType,
            content: createPayload.content,
            notes:
              createPayload.notes === null ? undefined : createPayload.notes,
            ...(createPayload.pageSnapshotKey
              ? { pageSnapshotKey: createPayload.pageSnapshotKey }
              : {}),
            source: createPayload.source,
            sourceTitle: createPayload.sourceTitle,
            sourceUrl: createPayload.sourceUrl,
            tags: createPayload.tags,
            url: createPayload.url,
            userId: auth.validated.userId,
          }
        );
    operationCommitted = true;
    const responseBody = buildCreateCardResponse(
      result,
      request.url,
      "card" in result && result.card
        ? await loadCardLinks(ctx, auth.validated.userId, result.card._id)
        : undefined
    );
    await completeIdempotencyResponse(ctx, {
      keyHash: idempotencyState.keyHash,
      leaseToken: idempotencyState.leaseToken,
      requestHash: idempotencyState.requestHash,
      responseBody,
      responseStatus: 200,
      userId: auth.validated.userId,
    });

    return json(200, responseBody);
  } catch (error) {
    if (idempotencyState?.reserved && !operationCommitted) {
      await releaseReservationKeepingOriginalError(ctx, {
        keyHash: idempotencyState.keyHash,
        leaseToken: idempotencyState.leaseToken,
        requestHash: idempotencyState.requestHash,
        userId: auth.validated.userId,
      });
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
      internal.publicApiUploads.generateUploadUrlForUser,
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
    if (options.matchesNothing) {
      return json(200, {
        items: [],
        pageInfo: { hasMore: false, nextCursor: null },
      });
    }
    const { similarity } = options;
    const semantic =
      similarity || (options.searchQuery && options.mode !== "keyword")
        ? await fetchSemanticRanking(
            ctx,
            auth.validated.userId,
            options.semantic
          )
        : null;
    if (similarity && semantic?.outcome === "rate_limited") {
      return errorResponse(
        429,
        "RATE_LIMITED",
        "Too many searches. Try again in a minute."
      );
    }
    if (similarity && semantic?.outcome === "unavailable") {
      return errorResponse(
        503,
        "SERVICE_UNAVAILABLE",
        "Similar search is unavailable right now. Try again later."
      );
    }
    if (similarity && !semantic?.ranking) {
      return json(200, {
        items: [],
        pageInfo: { hasMore: false, nextCursor: null },
        searchMode: "semantic",
        similarity: semantic?.outcome === "pending" ? "pending" : "unavailable",
      });
    }
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
      sort: options.sort === "relevance" ? undefined : options.sort,
      type: options.type,
      types: options.types,
      userId: auth.validated.userId,
      ...options.qualifiers,
      ...(semanticRanking ? { semanticRanking, mode: options.mode } : {}),
      ...(similarity ? { similarity } : {}),
    };
    let cardsPage: {
      items: CardWithUrls[];
      pageInfo: { hasMore: boolean; nextCursor: string | null };
    };
    const bestMatchText =
      options.sort === "relevance" && options.semantic?.kind === "text"
        ? options.semantic.text
        : "";
    const bestMatch = Boolean(options.searchQuery && bestMatchText);
    let relevanceRanked: boolean | undefined;

    if (options.sort === "shuffle" && options.shuffleSeed !== undefined) {
      const items: CardWithUrls[] = [];
      let cursor = options.cursor;
      let hasMore = true;
      for (
        let read = 0;
        read < MAX_SHUFFLE_READS && items.length < options.limit && hasMore;
        read++
      ) {
        const page = await ctx.runQuery(
          internal.publicApi.shuffleCardsPageForUser,
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
    } else if (
      options.searchQuery ||
      options.tag ||
      options.qualifiers?.ocrTexts?.length ||
      similarity
    ) {
      const relevance = bestMatch
        ? await relevanceForPage(ctx, {
            cursor: options.cursor,
            spentToken: semantic?.spentToken === true,
            text: bestMatchText,
            userId: auth.validated.userId,
            candidateArgs: {
              ...queryArgs,
              cursor: undefined,
              limit: RELEVANCE_CANDIDATE_LIMIT,
              searchQuery: options.searchQuery,
              tag: options.tag,
              relevance: {},
            },
          })
        : undefined;
      relevanceRanked = relevance ? relevance.scores !== undefined : undefined;
      cardsPage = await ctx.runQuery(
        internal.publicApi.searchCardsPageForUser,
        {
          ...queryArgs,
          limit: options.limit,
          searchQuery: options.searchQuery,
          tag: options.tag,
          ...(relevance ? { relevance } : {}),
        }
      );
    } else {
      const items: CardWithUrls[] = [];
      let cursor = options.cursor;
      let nextCursor: string | null = null;
      let scannedRows = 0;
      let hasMore = false;

      while (scannedRows < MAX_QUERY_SCAN) {
        const scanLimit = Math.min(MAX_LIMIT, MAX_QUERY_SCAN - scannedRows);
        const scanPage = await ctx.runQuery(
          internal.publicApi.scanCardsPageForUser,
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
          nextCursor = cursor;
        }

        if (rowsRead === 0) {
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

    const items = include.has("processing")
      ? await withTranscripts(ctx, auth.validated.userId, cardsPage.items)
      : cardsPage.items;
    return json(200, {
      items: items.map((card) => serializeListCard(card, request.url, include)),
      pageInfo: cardsPage.pageInfo,
      ...(similarity ? { searchMode: "semantic", similarity: "ok" } : {}),
      ...(options.hasQuery && !similarity
        ? { searchMode: semanticRanking ? options.mode : "keyword" }
        : {}),
      ...(relevanceRanked === undefined ? {} : { relevanceRanked }),
    });
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to fetch cards");
  }
};

export const relevanceForPage = async (
  ctx: ActionCtx,
  {
    candidateArgs,
    cursor,
    spentToken,
    text,
    userId,
  }: {
    candidateArgs: Record<string, unknown>;
    cursor: string | undefined;
    spentToken: boolean;
    text: string;
    userId: string;
  }
): Promise<{ scores?: RelevanceScore[] }> => {
  const pinned = relevanceCursorRanked(cursor);
  if (pinned === false) {
    return {};
  }
  const candidates = await ctx.runQuery(
    internal.publicApi.searchCardsPageForUser,
    candidateArgs
  );
  const { outcome, scores } = await ensureRelevanceScores(ctx, {
    candidates: candidates.items,
    spentToken,
    text,
    timeoutMs: API_RELEVANCE_TIMEOUT_MS,
    userId,
  });
  if (pinned === true) {
    if (!scores?.length) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message:
          "Best match scores for this search have expired; start the search again",
      });
    }
    return { scores };
  }
  return outcome === "ok" ? { scores: scores ?? [] } : {};
};

const resolveCardId = (
  ctx: ActionCtx,
  cardId: string
): Promise<string | null> =>
  ctx.runQuery(internal.publicApi.cardsForUser.resolveCardIdForUserRequest, {
    cardId,
  });

/** A single card's response body, with its `[[…]]` links and backlinks. */
/**
 * A card's links and backlinks for a response. A failed lookup leaves them
 * out rather than failing a write that already happened.
 */
const loadCardLinks = async (
  ctx: ActionCtx,
  userId: string,
  cardId: Id<"cards">
) => {
  try {
    return (
      (await ctx.runQuery(internal["card/cardLinks"].getCardLinksForUser, {
        cardId,
        userId,
      })) ?? undefined
    );
  } catch (error) {
    console.warn("[publicApi] card links unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const serializeCardWithLinks = async (
  ctx: ActionCtx,
  userId: string,
  card: CardWithUrls,
  requestUrl: string
) =>
  serializeCard(card, requestUrl, await loadCardLinks(ctx, userId, card._id));

const ensureCardExistsForUser = (
  ctx: ActionCtx,
  userId: string,
  cardId: string,
  includeDeleted = false
): Promise<CardWithUrls | null> =>
  ctx
    .runQuery(internal.publicApi.cardsForUser.getCardForUser, {
      cardId,
      userId,
    })
    .then((card) => (card?.isDeleted && !includeDeleted ? null : card));

const SAVE_PDF_ERROR_STATUS: Partial<Record<string, number>> = {
  FILE_TOO_LARGE: 413,
  IN_PROGRESS: 409,
  SERVICE_UNAVAILABLE: 503,
  UNSUPPORTED_TYPE: 415,
};

const handleSavePdfRequest = async (
  ctx: ActionCtx,
  userId: string,
  cardId: Id<"cards">
): Promise<Response> => {
  try {
    const result = await ctx.runAction(
      internal.card.saveLinkedPdf.saveLinkedPdfForUser,
      { cardId, userId }
    );
    if (result.created) {
      await captureBackendEvent("link_pdf_saved", userId, { source: "api" });
    }
    return json(result.created ? 201 : 200, result);
  } catch (error) {
    const data = error instanceof ConvexError ? error.data : undefined;
    const status =
      typeof data?.code === "string"
        ? SAVE_PDF_ERROR_STATUS[data.code]
        : undefined;
    if (status) {
      return json(status, { code: data.code, error: data.message });
    }
    return mapConvexErrorToResponse(error, "Failed to save the PDF");
  }
};

const cardContentResponse = async (
  ctx: ActionCtx,
  userId: string,
  cardId: Id<"cards">
): Promise<Response> => {
  const source = await ctx.runQuery(
    internal["card/documentText"].getCardTextSource,
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

const thumbnailErrorResponse = (error: unknown, fallbackMessage: string) => {
  const data =
    error instanceof ConvexError
      ? (error.data as { code?: unknown; message?: unknown } | undefined)
      : undefined;
  if (data?.code === "FILE_TOO_LARGE") {
    return errorResponse(413, "FILE_TOO_LARGE", String(data.message));
  }
  return mapConvexErrorToResponse(error, fallbackMessage);
};

const handleThumbnailRequest = async (
  ctx: ActionCtx,
  request: Request,
  {
    cardId,
    operation,
    userId,
  }: {
    cardId: Id<"cards">;
    operation: "thumbnail-reset" | "thumbnail-set" | "thumbnail-upload";
    userId: string;
  }
): Promise<Response> => {
  const respondWithCard = async () => {
    const card = await ensureCardExistsForUser(ctx, userId, cardId, true);
    return card
      ? json(200, await serializeCardWithLinks(ctx, userId, card, request.url))
      : errorResponse(404, "NOT_FOUND", "Card not found");
  };

  if (operation === "thumbnail-reset") {
    try {
      const result = await ctx.runMutation(
        internal.card.thumbnailOverride.resetLinkThumbnailForUser,
        { cardId, userId }
      );
      if (result.changeId) {
        await captureBackendEvent("card_thumbnail_reset", userId, {});
      }
      return await respondWithCard();
    } catch (error) {
      return thumbnailErrorResponse(error, "Failed to reset the image");
    }
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(request);
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (operation === "thumbnail-upload") {
    const upload = validateThumbnailUploadPayload(payload);
    if (!upload) {
      return errorResponse(
        400,
        "INVALID_INPUT",
        "Body must include only mimeType and fileSize"
      );
    }
    try {
      return json(
        200,
        await ctx.runMutation(
          internal.card.thumbnailOverride.createThumbnailUploadUrlForUser,
          { ...upload, cardId, userId }
        )
      );
    } catch (error) {
      return thumbnailErrorResponse(error, "Failed to prepare the upload");
    }
  }

  const thumbnail = validateThumbnailSetPayload(payload);
  if (!thumbnail) {
    return errorResponse(400, "INVALID_INPUT", "Body must include fileKey");
  }
  try {
    await ctx.runAction(
      internal.card.thumbnailOverride.setLinkThumbnailForUser,
      { cardId, fileKey: thumbnail.fileKey, userId }
    );
    await captureBackendEvent("card_thumbnail_replaced", userId, {
      source: "api",
    });
    return await respondWithCard();
  } catch (error) {
    return thumbnailErrorResponse(error, "Failed to replace the image");
  }
};

const OPERATIONS_THAT_SEE_TRASHED_CARDS: ReadonlySet<string> = new Set([
  "done",
  "refresh",
  "restore",
  "save-pdf",
  "thumbnail-reset",
  "thumbnail-set",
  "thumbnail-upload",
  "undone",
]);

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
    OPERATIONS_THAT_SEE_TRASHED_CARDS.has(route.operation) ||
      (route.operation === "delete" && permanent === "true")
  );
  if (!currentCard) {
    return errorResponse(404, "NOT_FOUND", "Card not found");
  }

  if (route.operation === "get") {
    return json(
      200,
      await serializeCardWithLinks(
        ctx,
        auth.validated.userId,
        currentCard,
        request.url
      )
    );
  }

  if (
    route.operation === "thumbnail-upload" ||
    route.operation === "thumbnail-set" ||
    route.operation === "thumbnail-reset"
  ) {
    return await handleThumbnailRequest(ctx, request, {
      cardId: normalizedCardId as Id<"cards">,
      operation: route.operation,
      userId: auth.validated.userId,
    });
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

  if (route.operation === "done" || route.operation === "undone") {
    const done = route.operation === "done";
    try {
      const result = await ctx.runMutation(
        internal.publicApi.cardsForUser.setCardDoneForUser,
        {
          cardId: normalizedCardId as Id<"cards">,
          done,
          userId: auth.validated.userId,
        }
      );
      if (!result) {
        return errorResponse(404, "NOT_FOUND", "Card not found");
      }
      if (result.changed) {
        await captureBackendEvent("card_done_toggled", auth.validated.userId, {
          category: result.card.metadata?.linkCategory?.category ?? "none",
          done,
          source: "api",
        });
      }
      return json(
        200,
        await serializeCardWithLinks(
          ctx,
          auth.validated.userId,
          result.card,
          request.url
        )
      );
    } catch (error) {
      return mapConvexErrorToResponse(error, "Failed to update done state");
    }
  }

  if (route.operation === "save-pdf") {
    return await handleSavePdfRequest(
      ctx,
      auth.validated.userId,
      normalizedCardId as Id<"cards">
    );
  }

  if (route.operation === "delete" || route.operation === "restore") {
    try {
      let mutation = internal.publicApi.cardsForUser.softDeleteCardForUser;
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
        internal.publicApi.cardsForUser.patchCardForUser,
        {
          ...patchPayload,
          cardId: normalizedCardId,
          userId: auth.validated.userId,
        }
      );

      if (!updated) {
        return errorResponse(404, "NOT_FOUND", "Card not found");
      }

      return json(
        200,
        await serializeCardWithLinks(
          ctx,
          auth.validated.userId,
          updated,
          request.url
        )
      );
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
        internal.publicApi.cardsForUser.setCardFavoriteForUser,
        {
          cardId: normalizedCardId,
          isFavorited: favoritePayload.isFavorited,
          userId: auth.validated.userId,
        }
      );

      if (!updated) {
        return errorResponse(404, "NOT_FOUND", "Card not found");
      }

      return json(
        200,
        await serializeCardWithLinks(
          ctx,
          auth.validated.userId,
          updated,
          request.url
        )
      );
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
    const fresh = await ctx.runQuery(
      internal.publicApi.getFreshTagSummaryForUser,
      { userId }
    );
    if (fresh) {
      return json(200, { items: fresh.items, isComplete: true });
    }
    const tags = await ctx.runQuery(internal.publicApi.listTagsForUser, {
      userId,
    });
    if (tags.isComplete) {
      return json(200, { items: tags.items, isComplete: true });
    }
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
      internal.publicApi.listCardChangesForUser,
      {
        cursor: parseOptionalString(searchParams.get("cursor")),
        limit: parseLimit(searchParams.get("limit")),
        since,
        userId: auth.validated.userId,
      }
    );

    const items = await withTranscripts<CardWithUrls>(
      ctx,
      auth.validated.userId,
      changes.items
    );
    return json(200, {
      deletedIds: changes.deletedIds,
      items: items.map((card) => serializeCard(card, request.url)),
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
      internal.publicApi.executeBulkCardsForUser,
      {
        items,
        operation,
        userId: auth.validated.userId,
      }
    );
    operationCommitted = true;
    await completeIdempotencyResponse(ctx, {
      keyHash: idempotencyState.keyHash,
      leaseToken: idempotencyState.leaseToken,
      requestHash: idempotencyState.requestHash,
      responseBody: result,
      responseStatus: 200,
      userId: auth.validated.userId,
    });

    return json(200, result);
  } catch (error) {
    if (idempotencyState?.reserved && !operationCommitted) {
      await releaseReservationKeepingOriginalError(ctx, {
        keyHash: idempotencyState.keyHash,
        leaseToken: idempotencyState.leaseToken,
        requestHash: idempotencyState.requestHash,
        userId: auth.validated.userId,
      });
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
