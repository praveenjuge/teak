/**
 * Public API route handlers: every /v1 endpoint implementation.
 * Split out of `publicApiHttp.ts`, kept behavior-identical.
 */
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
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
  parseIncludeSet,
  serializeCard,
  serializeListCard,
  validateCreatePayload,
  validateFavoritePayload,
  validatePatchPayload,
  validateUploadPayload,
} from "./publicApiHttpValidation";

const handleCreateCardRequest = async (
  ctx: ActionCtx,
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
      "Body must include text, a URL, or valid uploaded-file fields"
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

const handleCardsListRequest = async (
  ctx: ActionCtx,
  request: Request
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  const options = parseCardsQueryOptions(request);
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
      types: options.types,
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
  cardId: string
): Promise<any | null> =>
  ctx
    .runQuery((internal as any).raycast.getCardForUser, {
      cardId,
      userId,
    })
    .then((card: any | null) => (card?.isDeleted ? null : card));

const handleCardsByIdV1Request = async (
  ctx: ActionCtx,
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
  ctx: ActionCtx,
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
  ctx: ActionCtx,
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

export {
  handleBulkCardsRequest,
  handleCardChangesRequest,
  handleCardsByIdV1Request,
  handleCardsListRequest,
  handleCreateCardRequest,
  handleCreateUploadRequest,
  handleTagsRequest,
};
