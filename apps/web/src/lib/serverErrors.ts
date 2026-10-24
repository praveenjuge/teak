import { MAX_FILES_PER_UPLOAD } from "@teak/convex/shared/constants";
import {
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDERS_PER_CARD,
  MAX_FOLDERS_PER_USER,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "@teak/convex/shared/folders";
import { MAX_TAG_NAME_LENGTH } from "@teak/convex/shared/tags";
import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";

type ErrorsTranslator = TeakTranslator<"errors">;
type ErrorGroup = keyof typeof englishMessages.errors;
type ErrorKey = {
  [G in ErrorGroup]: `${G}.${keyof (typeof englishMessages.errors)[G] & string}`;
}[ErrorGroup];

// The limits the server put in its English messages.
const LIMITS: Partial<Record<ErrorKey, number>> = {
  "folders.NAME_TOO_LONG": MAX_FOLDER_NAME_LENGTH,
  "folders.TOO_MANY_FOLDERS": MAX_FOLDERS_PER_USER,
  "folders.TOO_MANY_FOLDERS_ON_CARD": MAX_FOLDERS_PER_CARD,
  "folders.QUERY_TOO_LONG": MAX_SMART_FOLDER_QUERY_LENGTH,
  "tags.NAME_TOO_LONG": MAX_TAG_NAME_LENGTH,
  "cards.TOO_MANY_FILES": MAX_FILES_PER_UPLOAD,
};

export const translateErrorKey = (t: ErrorsTranslator, key: ErrorKey) =>
  t(key, { max: LIMITS[key] ?? 0 });

const errorKeys = Object.entries(englishMessages.errors).flatMap(
  ([group, messages]) =>
    Object.keys(messages).map((code) => `${group}.${code}` as ErrorKey)
);

// The server sends these messages in English, word for word. Matching the
// text tells the domains apart where codes repeat (NOT_FOUND, RATE_LIMITED).
export const keyByEnglishMessage = (() => {
  const english = createTeakTranslator("en", englishMessages, "errors");
  return new Map(
    errorKeys.map((key) => [translateErrorKey(english, key), key])
  );
})();

const CARD_CODES = new Set(Object.keys(englishMessages.errors.cards));

const errorData = (error: unknown) => {
  const data =
    error && typeof error === "object" && "data" in error
      ? (error as { data?: unknown }).data
      : undefined;
  return data && typeof data === "object"
    ? (data as { code?: unknown; message?: unknown })
    : undefined;
};

/**
 * A server error in the UI language. Known messages and card codes are
 * translated; anything else shows the server's English text, else the
 * fallback.
 */
export const serverErrorMessage = (
  t: ErrorsTranslator,
  error: unknown,
  fallback: string
): string => {
  const data = errorData(error);
  const message = typeof data?.message === "string" ? data.message : undefined;
  const known = message ? keyByEnglishMessage.get(message) : undefined;
  if (known) {
    return translateErrorKey(t, known);
  }
  if (typeof data?.code === "string" && CARD_CODES.has(data.code)) {
    return translateErrorKey(t, `cards.${data.code}` as ErrorKey);
  }
  return message ?? fallback;
};

export type { ErrorKey, ErrorsTranslator };
