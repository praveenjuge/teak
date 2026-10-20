const FALLBACK_MESSAGE = "Couldn't refresh this card. Try again in a moment.";

const USER_FACING_CODES = new Set(["CONFLICT", "NOT_FOUND", "RATE_LIMITED"]);

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
