const FALLBACK_MESSAGE = "Couldn't refresh this card. Try again in a moment.";

// Backend refusals the person can act on carry their own sentence.
const USER_FACING_CODES = new Set(["CONFLICT", "NOT_FOUND", "RATE_LIMITED"]);

/**
 * The toast text for a failed "Refresh details": the backend's own message for a
 * rate limit, a card in Trash or a missing card, and a generic line for
 * anything else (network errors, internal failures).
 */
export function getReprocessErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return FALLBACK_MESSAGE;
  }
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") {
    return FALLBACK_MESSAGE;
  }
  const { code, message } = data as { code?: unknown; message?: unknown };
  return typeof code === "string" &&
    USER_FACING_CODES.has(code) &&
    typeof message === "string" &&
    message.trim()
    ? message
    : FALLBACK_MESSAGE;
}
