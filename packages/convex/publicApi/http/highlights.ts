import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import { readArticleReaderText } from "../../highlight/anchorPending";
import { HIGHLIGHT_ERROR_MESSAGES } from "../../highlight/highlights";
import { anchorQuote } from "../../shared/highlights/anchor";
import {
  highlightLength,
  MAX_HIGHLIGHT_NOTE_CHARS,
  MAX_HIGHLIGHT_QUOTE_CHARS,
} from "../../shared/highlights/constants";
import type { WorkosResource } from "../../workos/tokens";
import { withAuthorizedUser } from "./auth";
import { serializeHighlight } from "./serializers";
import {
  errorResponse,
  json,
  mapConvexErrorToResponse,
  parseJsonBody,
} from "./shared";

const CARD_HIGHLIGHTS_PATH = /^\/v1\/cards\/([^/]+)\/highlights$/;
const HIGHLIGHT_PATH = /^\/v1\/highlights\/([^/]+)$/;

/** `/v1/cards/{cardId}/highlights`. */
export const isCardHighlightsPath = (pathname: string): boolean =>
  CARD_HIGHLIGHTS_PATH.test(pathname);

/** `/v1/highlights/{highlightId}`. */
export const isHighlightPath = (pathname: string): boolean =>
  HIGHLIGHT_PATH.test(pathname);

const pathId = (request: Request, pattern: RegExp): string | null => {
  const match = pattern.exec(new URL(request.url).pathname)?.[1];
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match);
  } catch {
    return null;
  }
};

const readJson = async (
  request: Request
): Promise<{ payload: Record<string, unknown> } | { error: Response }> => {
  try {
    const payload = await parseJsonBody(request);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {
        error: errorResponse(400, "INVALID_INPUT", "Send a JSON object"),
      };
    }
    return { payload: payload as Record<string, unknown> };
  } catch {
    return { error: errorResponse(400, "BAD_REQUEST", "Invalid JSON body") };
  }
};

const optionalText = (
  payload: Record<string, unknown>,
  key: string
): { value: string | undefined } | { error: string } => {
  const value = payload[key];
  if (value === undefined || value === null) {
    return { value: undefined };
  }
  return typeof value === "string"
    ? { value }
    : { error: `\`${key}\` must be a string` };
};

const invalid = (message: string) =>
  errorResponse(400, "INVALID_INPUT", message);

const noteError = (note: string | undefined) =>
  note !== undefined && highlightLength(note.trim()) > MAX_HIGHLIGHT_NOTE_CHARS
    ? HIGHLIGHT_ERROR_MESSAGES.NOTE_TOO_LONG
    : null;

/**
 * POST: finds the quote in the card's saved article (the first match, unless
 * `prefix` or `suffix` points at another) and highlights it. 201 for a new
 * highlight; 200 when the passage was highlighted already, or the new one
 * merged into one it overlapped.
 */
const createHighlight = async (
  ctx: ActionCtx,
  userId: string,
  cardId: string,
  request: Request
): Promise<Response> => {
  const body = await readJson(request);
  if ("error" in body) {
    return body.error;
  }
  const quote = body.payload.quote;
  if (typeof quote !== "string" || !quote.trim()) {
    return invalid("`quote` must be the text to highlight");
  }
  if (highlightLength(quote.trim()) > MAX_HIGHLIGHT_QUOTE_CHARS) {
    return invalid(HIGHLIGHT_ERROR_MESSAGES.QUOTE_TOO_LONG);
  }
  const fields = {
    note: optionalText(body.payload, "note"),
    prefix: optionalText(body.payload, "prefix"),
    suffix: optionalText(body.payload, "suffix"),
  };
  for (const field of Object.values(fields)) {
    if ("error" in field) {
      return invalid(field.error);
    }
  }
  const note = (fields.note as { value?: string }).value;
  const tooLong = noteError(note);
  if (tooLong) {
    return invalid(tooLong);
  }
  try {
    const source = await ctx.runQuery(
      internal.publicApiHighlights.getHighlightArticleForApi,
      { userId, cardId }
    );
    let text: string;
    try {
      text = await readArticleReaderText(source);
    } catch (error) {
      console.warn("[publicApi] article text unreadable", {
        cardId,
        message: error instanceof Error ? error.message : String(error),
      });
      return errorResponse(
        503,
        "SERVICE_UNAVAILABLE",
        "The saved article couldn't be read. Try again."
      );
    }
    const anchor = anchorQuote(text, {
      quote,
      prefix: (fields.prefix as { value?: string }).value,
      suffix: (fields.suffix as { value?: string }).value,
    });
    if (!anchor) {
      return errorResponse(
        422,
        "QUOTE_NOT_FOUND",
        HIGHLIGHT_ERROR_MESSAGES.QUOTE_NOT_FOUND
      );
    }
    const result = await ctx.runMutation(
      internal.publicApiHighlights.createHighlightForApi,
      {
        userId,
        cardId: source.cardId,
        quote: text.slice(anchor.start, anchor.end),
        prefix: anchor.prefix,
        suffix: anchor.suffix,
        start: anchor.start,
        end: anchor.end,
        ...(note?.trim() ? { note } : {}),
      }
    );
    return json(
      result.created ? 201 : 200,
      serializeHighlight(result.highlight)
    );
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to create the highlight");
  }
};

/** `GET` and `POST /v1/cards/{cardId}/highlights`. */
export const handleCardHighlightsRequest = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const cardId = pathId(request, CARD_HIGHLIGHTS_PATH);
  if (!cardId) {
    return errorResponse(404, "NOT_FOUND", "Card not found");
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }
  const userId = auth.validated.userId;
  if (request.method === "POST") {
    return createHighlight(ctx, userId, cardId, request);
  }
  try {
    const rows = await ctx.runQuery(
      internal.publicApiHighlights.listHighlightsForApi,
      { userId, cardId }
    );
    return json(200, { items: rows.map(serializeHighlight) });
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to list highlights");
  }
};

/** `PATCH` (the note) and `DELETE /v1/highlights/{highlightId}`. */
export const handleHighlightRequest = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const highlightId = pathId(request, HIGHLIGHT_PATH);
  if (!highlightId) {
    return errorResponse(404, "NOT_FOUND", "Highlight not found");
  }
  if (request.method !== "PATCH" && request.method !== "DELETE") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }
  const userId = auth.validated.userId;
  try {
    if (request.method === "DELETE") {
      await ctx.runMutation(
        internal.publicApiHighlights.deleteHighlightForApi,
        {
          userId,
          highlightId,
        }
      );
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const body = await readJson(request);
    if ("error" in body) {
      return body.error;
    }
    const note = body.payload.note;
    if (
      !("note" in body.payload) ||
      (note !== null && typeof note !== "string")
    ) {
      return invalid("`note` must be a string, or null to clear it");
    }
    const tooLong = noteError(note ?? undefined);
    if (tooLong) {
      return invalid(tooLong);
    }
    const highlight = await ctx.runMutation(
      internal.publicApiHighlights.updateHighlightForApi,
      { userId, highlightId, note }
    );
    return json(200, serializeHighlight(highlight));
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to update the highlight");
  }
};
