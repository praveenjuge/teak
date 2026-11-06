import { internal } from "../../_generated/api";
import { readArticleReaderText } from "../../highlight/anchorPending";
import { HIGHLIGHT_ERROR_MESSAGES } from "../../highlight/highlights";
import { anchorQuote } from "../../shared/highlights/anchor";
import {
  highlightLength,
  MAX_HIGHLIGHT_NOTE_CHARS,
  MAX_HIGHLIGHT_QUOTE_CHARS,
} from "../../shared/highlights/constants";
import { noContent, type PublicApiCall } from "./operation";
import { serializeHighlight } from "./serializers";
import { errorResponse, json, mapConvexErrorToResponse } from "./shared";

const objectBody = (
  body: unknown
): { payload: Record<string, unknown> } | { error: Response } =>
  body && typeof body === "object" && !Array.isArray(body)
    ? { payload: body as Record<string, unknown> }
    : { error: errorResponse(400, "INVALID_INPUT", "Send a JSON object") };

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
export const handleCreateHighlightRequest = async ({
  body: rawBody,
  ctx,
  params,
  userId,
}: PublicApiCall): Promise<Response> => {
  const cardId = params.cardId;
  const body = objectBody(rawBody);
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
        // The text the quote was found in: a card whose article changed
        // since refuses the offsets.
        articleKey: source.textKey,
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

export const handleListHighlightsRequest = async ({
  ctx,
  params,
  userId,
}: PublicApiCall): Promise<Response> => {
  try {
    const rows = await ctx.runQuery(
      internal.publicApiHighlights.listHighlightsForApi,
      { userId, cardId: params.cardId }
    );
    return json(200, { items: rows.map(serializeHighlight) });
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to list highlights");
  }
};

export const handleDeleteHighlightRequest = async ({
  ctx,
  params,
  userId,
}: PublicApiCall): Promise<Response> => {
  try {
    await ctx.runMutation(internal.publicApiHighlights.deleteHighlightForApi, {
      userId,
      highlightId: params.highlightId,
    });
    return noContent();
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to update the highlight");
  }
};

export const handleUpdateHighlightRequest = async ({
  body: rawBody,
  ctx,
  params,
  userId,
}: PublicApiCall): Promise<Response> => {
  const body = objectBody(rawBody);
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
  try {
    const highlight = await ctx.runMutation(
      internal.publicApiHighlights.updateHighlightForApi,
      { userId, highlightId: params.highlightId, note }
    );
    return json(200, serializeHighlight(highlight));
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to update the highlight");
  }
};
