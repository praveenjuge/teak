import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const APP_PROD_URL = "https://app.teakvault.com";
const APP_DEV_URL = "http://localhost:3000";
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
type CardsQueryOptions = {
  createdAfter?: number;
  createdBefore?: number;
  favoritesOnly: boolean;
  limit: number;
  searchQuery?: string;
  sort?: "newest" | "oldest";
  tag?: string;
  type?: string;
};
type CreateCardPayload = {
  content?: string;
  notes?: string | null;
  source?: string;
  tags?: string[];
  url?: string;
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
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

const getAppBaseUrl = (requestUrl: string): string => {
  const { hostname } = new URL(requestUrl);
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? APP_DEV_URL
    : APP_PROD_URL;
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
    return undefined;
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
    return undefined;
  }

  const normalized = Array.from(
    new Set(value.map((entry) => entry.trim()).filter(Boolean))
  );

  return normalized.length > 0 ? normalized : [];
};

const validateCreatePayload = (payload: unknown): CreateCardPayload | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const source = payload as Record<string, unknown>;
  const allowedKeys = new Set(["content", "notes", "source", "tags", "url"]);

  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) {
      return null;
    }
  }

  const content = parseOptionalString(source.content);
  const url = parseOptionalString(source.url);
  const notes = parseOptionalNullableString(source.notes);
  const sourceValue = parseOptionalString(source.source);
  const tags =
    source.tags === undefined ? undefined : parseStringArray(source.tags);

  if (source.tags !== undefined && tags === undefined) {
    return null;
  }

  if (
    source.notes !== undefined &&
    !(typeof source.notes === "string" || source.notes === null)
  ) {
    return null;
  }

  if (!(content || url)) {
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

const parseBooleanQuery = (value: string | null): boolean | undefined => {
  if (!value) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
};

const parseTimestampQuery = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
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

  try {
    const result = await ctx.runMutation(
      (internal as any).raycast.quickSaveForUser,
      {
        content: createPayload.content,
        notes: createPayload.notes === null ? undefined : createPayload.notes,
        source: createPayload.source,
        tags: createPayload.tags,
        url: createPayload.url,
        userId: auth.validated.userId,
      }
    );

    return json(200, buildCreateCardResponse(result, request.url));
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
  return ctx.runQuery((internal as any).raycast.getCardForUser, {
    cardId,
    userId,
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
    next.content = source.content.trim();
  }

  if ("url" in source) {
    if (typeof source.url !== "string" || !source.url.trim()) {
      return null;
    }
    next.url = source.url.trim();
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
    return mapConvexErrorToResponse(error, "Failed to update favorite status");
  }
};

export const quickSave = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  return handleCreateCardRequest(ctx, request);
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

  return handleCreateCardRequest(ctx, request);
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
  if (
    !(
      request.method === "DELETE" ||
      request.method === "GET" ||
      request.method === "PATCH"
    )
  ) {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  return handleCardsByIdV1Request(ctx, request);
});
