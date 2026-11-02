import { CARD_ERROR_CODES } from "@teak/convex/shared";

type CardErrorCode = (typeof CARD_ERROR_CODES)[keyof typeof CARD_ERROR_CODES];

const CARD_ERROR_CODE_SET: ReadonlySet<string> = new Set(
  Object.values(CARD_ERROR_CODES)
);

const asCardErrorCode = (code: unknown): CardErrorCode | null =>
  typeof code === "string" && CARD_ERROR_CODE_SET.has(code)
    ? (code as CardErrorCode)
    : null;

/**
 * The card error a call failed with: a Convex error's `data.code`, or the
 * `code` of an error the client made itself. `null` for anything else.
 */
export function cardErrorCode(error: unknown): CardErrorCode | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const { code, data } = error as { code?: unknown; data?: { code?: unknown } };
  return asCardErrorCode(code) ?? asCardErrorCode(data?.code);
}

export const isCardLimitError = (error: unknown): boolean =>
  cardErrorCode(error) === CARD_ERROR_CODES.CARD_LIMIT_REACHED;

export const isRateLimitError = (error: unknown): boolean =>
  cardErrorCode(error) === CARD_ERROR_CODES.RATE_LIMITED;
