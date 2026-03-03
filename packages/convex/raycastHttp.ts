import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type ErrorCode =
  | "BAD_REQUEST"
  | "INTERNAL_ERROR"
  | "INVALID_API_KEY"
  | "INVALID_INPUT"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UNAUTHORIZED";

type AuthorizedUser = {
  keyId: string;
  userId: string;
  access: "full_access";
};

type AuthResult = { validated: AuthorizedUser } | { error: Response };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const errorResponse = (
  status: number,
  code: ErrorCode,
  error: string,
  extras?: Record<string, unknown>
): Response => {
  return json(status, { code, error, ...(extras ?? {}) });
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

  let rateLimit: { ok?: boolean; retryAt?: number } | null = null;
  try {
    rateLimit = await ctx.runMutation(
      (internal as any).raycast.checkApiRateLimit,
      {
        token,
      }
    );
  } catch (error) {
    if (isRateLimitContentionError(error)) {
      return {
        error: errorResponse(429, "RATE_LIMITED", "Too many requests", {
          retryAt: Date.now() + 1000,
        }),
      };
    }

    return {
      error: errorResponse(
        500,
        "INTERNAL_ERROR",
        "Failed to authorize request"
      ),
    };
  }

  if (!rateLimit?.ok) {
    return {
      error: errorResponse(429, "RATE_LIMITED", "Too many requests", {
        retryAt: rateLimit?.retryAt,
      }),
    };
  }

  let validated: AuthorizedUser | null = null;
  try {
    validated = await ctx.runMutation(
      (internal as any).apiKeys.validateUserApiKey,
      {
        token,
      }
    );
  } catch {
    return {
      error: errorResponse(
        500,
        "INTERNAL_ERROR",
        "Failed to authorize request"
      ),
    };
  }

  if (!validated) {
    return {
      error: errorResponse(
        401,
        "INVALID_API_KEY",
        "Invalid or revoked API key"
      ),
    };
  }

  return { validated };
};

const serializeCard = (card: any) => ({
  id: card._id,
  type: card.type,
  content: card.content,
  notes: card.notes ?? null,
  url: card.url ?? null,
  tags: card.tags ?? [],
  aiTags: card.aiTags ?? [],
  aiSummary: card.aiSummary ?? null,
  isFavorited: Boolean(card.isFavorited),
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
  fileUrl: card.fileUrl ?? null,
  thumbnailUrl: card.thumbnailUrl ?? null,
  screenshotUrl: card.screenshotUrl ?? null,
  linkPreviewImageUrl: card.linkPreviewImageUrl ?? null,
  metadataTitle: card.metadataTitle ?? null,
  metadataDescription: card.metadataDescription ?? null,
});

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

const handleQuickSaveRequest = async (
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

  const content =
    payload && typeof payload === "object" && "content" in payload
      ? (payload as { content?: unknown }).content
      : undefined;

  if (typeof content !== "string" || !content.trim()) {
    return errorResponse(
      400,
      "INVALID_INPUT",
      "Field `content` must be a non-empty string"
    );
  }

  try {
    const result = await ctx.runMutation(
      (internal as any).raycast.quickSaveForUser,
      {
        userId: auth.validated.userId,
        content,
      }
    );

    return json(200, result);
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to save card");
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

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? undefined;
  const limit = parseLimit(searchParams.get("limit"));

  try {
    const cards = await ctx.runQuery(
      favoritesOnly
        ? (internal as any).raycast.favoriteCardsForUser
        : (internal as any).raycast.searchCardsForUser,
      {
        userId: auth.validated.userId,
        searchQuery: query,
        limit,
      }
    );

    return json(200, {
      items: cards.map(serializeCard),
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

const parseCardRoute = (
  request: Request
): {
  cardId: string;
  operation: "patch" | "delete" | "favorite";
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

const resolveCardId = async (
  ctx: any,
  cardId: string
): Promise<string | null> => {
  return ctx.runQuery((internal as any).raycast.resolveCardIdForUserRequest, {
    cardId,
  });
};

const ensureCardExistsForUser = async (
  ctx: any,
  userId: string,
  cardId: string
): Promise<any | null> => {
  return ctx.runQuery((internal as any)["card/getCard"].getCardForUser, {
    userId,
    cardId,
  });
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
    if (typeof source.content !== "string" || !source.content.trim()) {
      return null;
    }
    next.content = source.content;
  }

  if ("url" in source) {
    if (typeof source.url !== "string" || !source.url.trim()) {
      return null;
    }
    next.url = source.url;
  }

  if ("notes" in source) {
    if (!(typeof source.notes === "string" || source.notes === null)) {
      return null;
    }
    next.notes = source.notes;
  }

  if ("tags" in source) {
    if (
      !(
        Array.isArray(source.tags) &&
        source.tags.every((tag) => typeof tag === "string")
      )
    ) {
      return null;
    }
    next.tags = source.tags;
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

  if (route.operation === "delete") {
    try {
      await ctx.runMutation((internal as any).raycast.softDeleteCardForUser, {
        userId: auth.validated.userId,
        cardId: normalizedCardId,
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
          userId: auth.validated.userId,
          cardId: normalizedCardId,
          ...patchPayload,
        }
      );

      if (!updated) {
        return errorResponse(404, "NOT_FOUND", "Card not found");
      }

      return json(200, serializeCard(updated));
    } catch (error) {
      return mapConvexErrorToResponse(error, "Failed to update card");
    }
  }

  const favoritePayload = validateFavoritePayload(payload);
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
        userId: auth.validated.userId,
        cardId: normalizedCardId,
        isFavorited: favoritePayload.isFavorited,
      }
    );

    if (!updated) {
      return errorResponse(404, "NOT_FOUND", "Card not found");
    }

    return json(200, serializeCard(updated));
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to update favorite status");
  }
};

export const quickSave = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  return handleQuickSaveRequest(ctx, request);
});

export const searchCards = httpAction(async (ctx, request) => {
  if (request.method !== "GET") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  return handleCardsQueryRequest(ctx, request, false);
});

export const favoriteCards = httpAction(async (ctx, request) => {
  if (request.method !== "GET") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  return handleCardsQueryRequest(ctx, request, true);
});

export const createCardV1 = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  return handleQuickSaveRequest(ctx, request);
});

export const searchCardsV1 = httpAction(async (ctx, request) => {
  if (request.method !== "GET") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  return handleCardsQueryRequest(ctx, request, false);
});

export const favoriteCardsV1 = httpAction(async (ctx, request) => {
  if (request.method !== "GET") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  return handleCardsQueryRequest(ctx, request, true);
});

export const cardByIdV1 = httpAction(async (ctx, request) => {
  if (!(request.method === "PATCH" || request.method === "DELETE")) {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  return handleCardsByIdV1Request(ctx, request);
});
