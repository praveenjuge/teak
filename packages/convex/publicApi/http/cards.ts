import { ConvexError } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import {
  CARD_TEXT_KINDS,
  type CardTextKind,
  readDocumentText,
} from "../../card/documentText";
import type { CardWithUrls } from "../../card/queryUtils";
import { withTranscripts } from "../../card/textContents";
import { ensureRelevanceScores } from "../../search/relevanceActions";
import { fetchSemanticRanking } from "../../search/semanticActions";
import { API_SEARCH_TIMEOUT_MS } from "../../search/timeouts";
import { replaceArticleImageTokens } from "../../shared/article";
import { combineSearchQueries } from "../../shared/search/qualifiers";
import {
  RELEVANCE_CANDIDATE_LIMIT,
  type RelevanceScore,
} from "../../shared/search/relevance";
import { tryResolveObjectUrl } from "../../storage/fileUrls";
import { captureBackendEvent } from "../../telemetry/posthog";
import { relevanceCursorRanked } from "../cursors";
import { parseOptionalString } from "../validation";
import { respondIdempotently } from "./auth";
import { noContent, type PublicApiCall, queryOf } from "./operation";
import {
  parseCreatePayload,
  parsePatchPayload,
  validateFavoritePayload,
  validatePinPayload,
  validateThumbnailSetPayload,
  validateThumbnailUploadPayload,
  validateUploadPayload,
} from "./payloads";
import { parseCardsQueryOptions, parseIncludeSet } from "./routeParsing";
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
  parseLimit,
  parseTimestampQuery,
} from "./shared";

const MAX_SHUFFLE_READS = 4;

const handleCreateCardRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const { ctx, request, userId } = call;

  const payload = call.body;
  const parsedCreate = parseCreatePayload(payload);
  if ("error" in parsedCreate) {
    return errorResponse(
      400,
      parsedCreate.code ?? "INVALID_INPUT",
      parsedCreate.error
    );
  }
  const createPayload = parsedCreate.payload;

  return await respondIdempotently(
    ctx,
    {
      failureMessage: "Failed to save card",
      path: "/v1/cards",
      request,
      requestBody: createPayload,
      userId,
    },
    async (committed) => {
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
                  createPayload.notes === null
                    ? undefined
                    : createPayload.notes,
                tags: createPayload.tags,
                userId,
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
              userId,
            }
          );
      committed();
      return buildCreateCardResponse(
        result,
        request.url,
        "card" in result && result.card
          ? await loadCardLinks(ctx, userId, result.card._id)
          : undefined
      );
    }
  );
};

const handleCreateUploadRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const { ctx, userId } = call;

  const payload = call.body;
  const uploadPayload = validateUploadPayload(payload);
  if (!uploadPayload) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Body must include only valid fields: fileName, mimeType, fileSize"
    );
  }

  const result = await ctx.runMutation(
    internal.publicApiUploads.generateUploadUrlForUser,
    {
      ...uploadPayload,
      userId,
    }
  );
  return json(200, result);
};

const handleCardsListRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const { ctx, request, userId } = call;

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

  let folderId: string | undefined;
  if (options.folder) {
    const folder = await ctx.runQuery(
      internal.publicApiFolders.getFolderForApi,
      { userId, folderId: options.folder }
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
      ? await fetchSemanticRanking(ctx, userId, options.semantic)
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
    pinned: options.pinnedOnly ? true : undefined,
    sort: options.sort === "relevance" ? undefined : options.sort,
    type: options.type,
    types: options.types,
    userId,
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

  const pinnedInOrder =
    options.pinnedOnly &&
    !(
      options.searchQuery ||
      options.tag ||
      options.qualifiers?.ocrTexts?.length ||
      similarity ||
      options.sort === "shuffle"
    );
  if (pinnedInOrder) {
    cardsPage = await ctx.runQuery(internal.publicApi.pinnedCardsPageForUser, {
      userId: queryArgs.userId,
      showTrashOnly: queryArgs.showTrashOnly,
      archived: queryArgs.archived,
      folderId: queryArgs.folderId,
      styleFilters: queryArgs.styleFilters,
      hueFilters: queryArgs.hueFilters,
      hexFilters: queryArgs.hexFilters,
      type: queryArgs.type,
      types: queryArgs.types,
      favorited: queryArgs.favorited,
      createdAfter: queryArgs.createdAfter,
      createdBefore: queryArgs.createdBefore,
      tags: queryArgs.tags,
      sites: queryArgs.sites,
      phrases: queryArgs.phrases,
      prices: queryArgs.prices,
      done: queryArgs.done,
      todo: queryArgs.todo,
      folderNames: queryArgs.folderNames,
      expression: queryArgs.expression,
    });
  } else if (options.sort === "shuffle" && options.shuffleSeed !== undefined) {
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
          userId,
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
    cardsPage = await ctx.runQuery(internal.publicApi.searchCardsPageForUser, {
      ...queryArgs,
      limit: options.limit,
      searchQuery: options.searchQuery,
      tag: options.tag,
      ...(relevance ? { relevance } : {}),
    });
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
    ? await withTranscripts(ctx, userId, cardsPage.items)
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
    timeoutMs: API_SEARCH_TIMEOUT_MS,
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

const withSignedArticleImages = async (
  markdown: string,
  imageKeys: readonly string[]
): Promise<string> => {
  const urls = await Promise.all(
    imageKeys.map((key) =>
      tryResolveObjectUrl(key).catch((error: unknown) => {
        // The article still reads without the image; its token stays a link.
        console.warn("[publicApi] article image unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
      })
    )
  );
  return replaceArticleImageTokens(
    markdown,
    (index) => urls[index] ?? undefined
  );
};

const cardContentResponse = async (
  ctx: ActionCtx,
  userId: string,
  cardId: Id<"cards">,
  kind: CardTextKind | undefined
): Promise<Response> => {
  const source = await ctx.runQuery(
    internal["card/documentText"].getCardTextSource,
    { cardId, userId, ...(kind ? { kind } : {}) }
  );
  if (!source) {
    return errorResponse(
      404,
      "NO_CONTENT",
      kind
        ? `This card has no stored text of kind \`${kind}\``
        : "This card has no stored text"
    );
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
  if (source.kind === "article") {
    text = await withSignedArticleImages(text, source.imageKeys ?? []);
  }
  return json(200, {
    cardId: source.cardId,
    kind: source.kind,
    text,
    charCount: source.charCount,
    truncated,
  });
};

const parseContentKind = (
  request: Request
): { kind: CardTextKind | undefined } | { error: Response } => {
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind === null) {
    return { kind: undefined };
  }
  return (CARD_TEXT_KINDS as readonly string[]).includes(kind)
    ? { kind: kind as CardTextKind }
    : {
        error: errorResponse(
          400,
          "INVALID_INPUT",
          `Query parameter \`kind\` must be one of: ${CARD_TEXT_KINDS.join(", ")}`
        ),
      };
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

/**
 * Resolves the `{cardId}` of a card operation to the caller's card, or
 * answers 404. Most operations see only cards outside Trash; the ones that
 * work on a card in Trash pass `includeDeleted`.
 */
const loadCard = async (
  call: PublicApiCall,
  options: {
    includeDeleted?: boolean;
    /** Checked once the id is known, before the card is read. */
    precheck?: () => Response | null;
  } = {}
): Promise<{ card: CardWithUrls; cardId: Id<"cards"> } | Response> => {
  const cardId = await resolveCardId(call.ctx, call.params.cardId);
  if (!cardId) {
    return errorResponse(404, "NOT_FOUND", "Card not found");
  }
  const refused = options.precheck?.();
  if (refused) {
    return refused;
  }
  const card = await ensureCardExistsForUser(
    call.ctx,
    call.userId,
    cardId,
    options.includeDeleted
  );
  return card
    ? { card, cardId: cardId as Id<"cards"> }
    : errorResponse(404, "NOT_FOUND", "Card not found");
};

const cardResponse = async (call: PublicApiCall, card: CardWithUrls) =>
  json(
    200,
    await serializeCardWithLinks(call.ctx, call.userId, card, call.request.url)
  );

const handleGetCardRequest = async (call: PublicApiCall) => {
  const loaded = await loadCard(call);
  return loaded instanceof Response
    ? loaded
    : await cardResponse(call, loaded.card);
};

const handleCardContentRequest = async (call: PublicApiCall) => {
  const loaded = await loadCard(call);
  if (loaded instanceof Response) {
    return loaded;
  }
  const parsed = parseContentKind(call.request);
  if ("error" in parsed) {
    return parsed.error;
  }
  return await cardContentResponse(
    call.ctx,
    call.userId,
    loaded.cardId,
    parsed.kind
  );
};

const thumbnailCardResponse = async (
  call: PublicApiCall,
  cardId: Id<"cards">
) => {
  const card = await ensureCardExistsForUser(
    call.ctx,
    call.userId,
    cardId,
    true
  );
  return card
    ? await cardResponse(call, card)
    : errorResponse(404, "NOT_FOUND", "Card not found");
};

const handleResetThumbnailRequest = async (call: PublicApiCall) => {
  const loaded = await loadCard(call, { includeDeleted: true });
  if (loaded instanceof Response) {
    return loaded;
  }
  try {
    const result = await call.ctx.runMutation(
      internal.card.thumbnailOverride.resetLinkThumbnailForUser,
      { cardId: loaded.cardId, userId: call.userId }
    );
    if (result.changeId) {
      await captureBackendEvent("card_thumbnail_reset", call.userId, {});
    }
    return await thumbnailCardResponse(call, loaded.cardId);
  } catch (error) {
    return thumbnailErrorResponse(error, "Failed to reset the image");
  }
};

const handleThumbnailUploadRequest = async (call: PublicApiCall) => {
  const loaded = await loadCard(call, { includeDeleted: true });
  if (loaded instanceof Response) {
    return loaded;
  }
  const upload = validateThumbnailUploadPayload(call.body);
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
      await call.ctx.runMutation(
        internal.card.thumbnailOverride.createThumbnailUploadUrlForUser,
        { ...upload, cardId: loaded.cardId, userId: call.userId }
      )
    );
  } catch (error) {
    return thumbnailErrorResponse(error, "Failed to prepare the upload");
  }
};

const handleSetThumbnailRequest = async (call: PublicApiCall) => {
  const loaded = await loadCard(call, { includeDeleted: true });
  if (loaded instanceof Response) {
    return loaded;
  }
  const thumbnail = validateThumbnailSetPayload(call.body);
  if (!thumbnail) {
    return errorResponse(400, "INVALID_INPUT", "Body must include fileKey");
  }
  try {
    await call.ctx.runAction(
      internal.card.thumbnailOverride.setLinkThumbnailForUser,
      { cardId: loaded.cardId, fileKey: thumbnail.fileKey, userId: call.userId }
    );
    await captureBackendEvent("card_thumbnail_replaced", call.userId, {
      source: "api",
    });
    return await thumbnailCardResponse(call, loaded.cardId);
  } catch (error) {
    return thumbnailErrorResponse(error, "Failed to replace the image");
  }
};

const handleRefreshCardRequest = async (call: PublicApiCall) => {
  const loaded = await loadCard(call, { includeDeleted: true });
  if (loaded instanceof Response) {
    return loaded;
  }
  const result = await call.ctx.runMutation(
    internal["card/updateCard"].reprocessCardForUser,
    { cardId: loaded.cardId, userId: call.userId }
  );
  return json(202, {
    cardId: result.cardId,
    requestedAt: result.requestedAt,
    status: "queued",
  });
};

const setDone =
  (done: boolean) =>
  async (call: PublicApiCall): Promise<Response> => {
    const loaded = await loadCard(call, { includeDeleted: true });
    if (loaded instanceof Response) {
      return loaded;
    }
    const result = await call.ctx.runMutation(
      internal.publicApi.cardsForUser.setCardDoneForUser,
      { cardId: loaded.cardId, done, userId: call.userId }
    );
    if (!result) {
      return errorResponse(404, "NOT_FOUND", "Card not found");
    }
    if (result.changed) {
      await captureBackendEvent("card_done_toggled", call.userId, {
        category: result.card.metadata?.linkCategory?.category ?? "none",
        done,
        source: "api",
      });
    }
    return await cardResponse(call, result.card);
  };

const handleSaveCardPdfRequest = async (call: PublicApiCall) => {
  const loaded = await loadCard(call, { includeDeleted: true });
  return loaded instanceof Response
    ? loaded
    : await handleSavePdfRequest(call.ctx, call.userId, loaded.cardId);
};

const handleRestoreCardRequest = async (call: PublicApiCall) => {
  const loaded = await loadCard(call, { includeDeleted: true });
  if (loaded instanceof Response) {
    return loaded;
  }
  await call.ctx.runMutation(internal["card/deleteCard"].restoreCardForUser, {
    cardId: loaded.cardId,
    userId: call.userId,
  });
  return noContent();
};

const handleDeleteCardRequest = async (call: PublicApiCall) => {
  const permanentParam = queryOf(call).get("permanent");
  const permanent = permanentParam === "true";
  const loaded = await loadCard(call, {
    includeDeleted: permanent,
    precheck: () =>
      permanentParam !== null && !["true", "false"].includes(permanentParam)
        ? errorResponse(
            400,
            "INVALID_INPUT",
            "Query parameter `permanent` must be `true` or `false`"
          )
        : null,
  });
  if (loaded instanceof Response) {
    return loaded;
  }
  if (permanent && !loaded.card.isDeleted) {
    return errorResponse(
      409,
      "NOT_IN_TRASH",
      "Move the card to Trash before deleting it permanently"
    );
  }
  await call.ctx.runMutation(
    permanent
      ? internal["card/deleteCard"].permanentDeleteCardForUser
      : internal.publicApi.cardsForUser.softDeleteCardForUser,
    { cardId: loaded.cardId, userId: call.userId }
  );
  return noContent();
};

const handleUpdateCardRequest = async (call: PublicApiCall) => {
  const loaded = await loadCard(call);
  if (loaded instanceof Response) {
    return loaded;
  }
  const parsedPatch = parsePatchPayload(call.body);
  if ("error" in parsedPatch) {
    return errorResponse(
      400,
      parsedPatch.code ?? "INVALID_INPUT",
      parsedPatch.error
    );
  }
  const patchPayload = parsedPatch.payload;
  if (
    patchPayload.content !== undefined &&
    loaded.card.type !== "text" &&
    !patchPayload.content.trim()
  ) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Text content cannot be empty for this card type"
    );
  }
  const updated = await call.ctx.runMutation(
    internal.publicApi.cardsForUser.patchCardForUser,
    { ...patchPayload, cardId: loaded.cardId, userId: call.userId }
  );
  return updated
    ? await cardResponse(call, updated)
    : errorResponse(404, "NOT_FOUND", "Card not found");
};

const handleSetPinnedRequest = async (call: PublicApiCall) => {
  const loaded = await loadCard(call);
  if (loaded instanceof Response) {
    return loaded;
  }
  const pinPayload = validatePinPayload(call.body);
  if (!pinPayload) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Body must include `isPinned` as a boolean"
    );
  }
  const result = await call.ctx.runMutation(
    internal.publicApi.cardsForUser.setCardPinnedForUser,
    {
      cardId: loaded.cardId,
      isPinned: pinPayload.isPinned,
      userId: call.userId,
    }
  );
  if (!result) {
    return errorResponse(404, "NOT_FOUND", "Card not found");
  }
  if (result.changed) {
    await captureBackendEvent("card_pin_toggled", call.userId, {
      pinned: pinPayload.isPinned,
      source: "api",
    });
  }
  return await cardResponse(call, result.card);
};

const handleSetFavoriteRequest = async (call: PublicApiCall) => {
  const loaded = await loadCard(call);
  if (loaded instanceof Response) {
    return loaded;
  }
  const favoritePayload = validateFavoritePayload(call.body);
  if (!favoritePayload) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Body must include `isFavorited` as a boolean"
    );
  }
  const updated = await call.ctx.runMutation(
    internal.publicApi.cardsForUser.setCardFavoriteForUser,
    {
      cardId: loaded.cardId,
      isFavorited: favoritePayload.isFavorited,
      userId: call.userId,
    }
  );
  return updated
    ? await cardResponse(call, updated)
    : errorResponse(404, "NOT_FOUND", "Card not found");
};

const handleCardChangesRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const { ctx, request, userId } = call;

  const { searchParams } = new URL(request.url);
  const since = parseTimestampQuery(searchParams.get("since"));
  if (!(typeof since === "number" && Number.isFinite(since))) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Query parameter `since` must be a number"
    );
  }
  const limit = parseLimit(searchParams.get("limit"));
  if (limit instanceof Response) {
    return limit;
  }

  const changes = await ctx.runQuery(
    internal.publicApi.listCardChangesForUser,
    {
      cursor: parseOptionalString(searchParams.get("cursor")),
      limit,
      since,
      userId,
    }
  );

  const items = await withTranscripts<CardWithUrls>(ctx, userId, changes.items);
  return json(200, {
    deletedIds: changes.deletedIds,
    items: items.map((card) => serializeCard(card, request.url)),
    pageInfo: changes.pageInfo,
  });
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
  call: PublicApiCall
): Promise<Response> => {
  const { ctx, request, userId } = call;

  const payload = call.body;
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

  return await respondIdempotently(
    ctx,
    {
      failureMessage: "Failed to execute bulk operation",
      path: "/v1/cards/bulk",
      request,
      requestBody: { items, operation },
      userId,
    },
    () =>
      ctx.runMutation(internal.publicApi.executeBulkCardsForUser, {
        items,
        operation,
        userId,
      })
  );
};

export {
  handleBulkCardsRequest,
  handleCardChangesRequest,
  handleCardContentRequest,
  handleCardsListRequest,
  handleCreateCardRequest,
  handleCreateUploadRequest,
  handleDeleteCardRequest,
  handleGetCardRequest,
  handleRefreshCardRequest,
  handleResetThumbnailRequest,
  handleRestoreCardRequest,
  handleSaveCardPdfRequest,
  handleSetFavoriteRequest,
  handleSetPinnedRequest,
  handleSetThumbnailRequest,
  handleThumbnailUploadRequest,
  handleUpdateCardRequest,
  setDone,
};
