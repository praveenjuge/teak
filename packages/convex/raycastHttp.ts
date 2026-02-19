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

  const rateLimit = await ctx.runMutation(
    (internal as any).raycast.checkApiRateLimit,
    {
      token,
    }
  );

  if (!rateLimit?.ok) {
    return {
      error: errorResponse(429, "RATE_LIMITED", "Too many requests", {
        retryAt: rateLimit?.retryAt,
      }),
    };
  }

  const validated = await ctx.runMutation(
    (internal as any).apiKeys.validateUserApiKey,
    {
      token,
    }
  );

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

export const quickSave = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  let payload: unknown;
  try {
    payload = await request.json();
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
    if (error instanceof ConvexError) {
      const payload = (error.data ?? {}) as {
        code?: unknown;
        message?: unknown;
      };
      const code =
        typeof payload.code === "string" ? payload.code : "BAD_REQUEST";
      const message =
        typeof payload.message === "string"
          ? payload.message
          : "Request failed";

      return json(400, {
        code,
        error: message,
      });
    }

    return errorResponse(500, "INTERNAL_ERROR", "Failed to save card");
  }
});

export const searchCards = httpAction(async (ctx, request) => {
  if (request.method !== "GET") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? undefined;
  const limit = parseLimit(searchParams.get("limit"));

  try {
    const cards = await ctx.runQuery(
      (internal as any).raycast.searchCardsForUser,
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
    return errorResponse(500, "INTERNAL_ERROR", "Failed to fetch cards");
  }
});

export const favoriteCards = httpAction(async (ctx, request) => {
  if (request.method !== "GET") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  const auth = await withAuthorizedUser(ctx, request);
  if ("error" in auth) {
    return auth.error;
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? undefined;
  const limit = parseLimit(searchParams.get("limit"));

  try {
    const cards = await ctx.runQuery(
      (internal as any).raycast.favoriteCardsForUser,
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
      "Failed to fetch favorite cards"
    );
  }
});
