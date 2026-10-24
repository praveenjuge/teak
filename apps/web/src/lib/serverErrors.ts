import { MAX_FILES_PER_UPLOAD } from "@teak/convex/shared/constants";
import {
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDERS_PER_CARD,
  MAX_FOLDERS_PER_USER,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "@teak/convex/shared/folders";
import { MAX_CARD_TAGS, MAX_TAG_NAME_LENGTH } from "@teak/convex/shared/tags";
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
  "cardTags.TAG_TOO_LONG": MAX_TAG_NAME_LENGTH,
  "cardTags.TOO_MANY_TAGS": MAX_CARD_TAGS,
  "cards.TOO_MANY_FILES": MAX_FILES_PER_UPLOAD,
};

// Messages that name what they're about, such as the tag in
// `tagExistsMessage`. The server fills in `{name}`.
const NAMED_KEYS: ReadonlySet<ErrorKey> = new Set(["tags.TAG_EXISTS"]);

export const translateErrorKey = (
  t: ErrorsTranslator,
  key: ErrorKey,
  values: { name?: string } = {}
) => t(key, { max: LIMITS[key] ?? 0, ...values });

const errorKeys = Object.entries(englishMessages.errors).flatMap(
  ([group, messages]) =>
    Object.keys(messages).map((code) => `${group}.${code}` as ErrorKey)
);

const english = createTeakTranslator("en", englishMessages, "errors");

// The server sends these messages in English, word for word. Matching the
// text tells the domains apart where codes repeat (NOT_FOUND, RATE_LIMITED).
const keyByEnglishMessage = new Map(
  errorKeys
    .filter((key) => !NAMED_KEYS.has(key))
    .map((key) => [translateErrorKey(english, key), key])
);

// A named message is recognized by the English around its `{name}`.
const NAME_MARK = "\u0000";
const namedMessages = [...NAMED_KEYS].map((key) => {
  const [prefix = "", suffix = ""] = translateErrorKey(english, key, {
    name: NAME_MARK,
  }).split(NAME_MARK);
  return { key, prefix, suffix };
});

const matchEnglishMessage = (
  message: string
): { key: ErrorKey; name?: string } | undefined => {
  const key = keyByEnglishMessage.get(message);
  if (key) {
    return { key };
  }
  const named = namedMessages.find(
    ({ prefix, suffix }) =>
      message.length > prefix.length + suffix.length &&
      message.startsWith(prefix) &&
      message.endsWith(suffix)
  );
  return named
    ? {
        key: named.key,
        name: message.slice(
          named.prefix.length,
          message.length - named.suffix.length
        ),
      }
    : undefined;
};

/**
 * A message the server sent in English, in the UI language when the catalog
 * knows it, else as sent.
 */
export const translateServerMessage = (
  t: ErrorsTranslator,
  message: string
): string => {
  const known = matchEnglishMessage(message);
  return known
    ? translateErrorKey(t, known.key, known.name ? { name: known.name } : {})
    : message;
};

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
  if (message && matchEnglishMessage(message)) {
    return translateServerMessage(t, message);
  }
  if (typeof data?.code === "string" && CARD_CODES.has(data.code)) {
    return translateErrorKey(t, `cards.${data.code}` as ErrorKey);
  }
  return message ?? fallback;
};

export type { ErrorKey, ErrorsTranslator };
