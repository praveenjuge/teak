/**
 * Every value from `packages/convex/shared` that the Apple and Android apps
 * read. Both apps generate their constants from this one manifest, so a value
 * either app uses reaches both:
 *   bun --no-env-file run apps/apple/scripts/shared-constants.ts --write
 *   bun --no-env-file run apps/android/scripts/shared-constants.ts --write
 */
import {
  bulkCardActionValidator,
  MAX_BULK_CARD_IDS,
} from "../../packages/convex/card/bulkActions";
import {
  CARD_LINK_PATTERN,
  CARD_LINK_TITLE_MAX_LENGTH,
  MAX_CARD_LINKS,
} from "../../packages/convex/shared/cardLinks";
import {
  CARD_ERROR_MESSAGES,
  CARD_TYPE_LABELS,
  COLOR_HUE_ALIAS_MAP,
  COLOR_HUE_BUCKETS,
  COLOR_HUE_LABELS,
  type ColorHueBucket,
  cardTypes,
  FREE_TIER_LIMIT,
  MAX_FILES_PER_UPLOAD,
  SIGNUPS_PAUSED_MESSAGE,
  VISUAL_STYLE_ALIAS_MAP,
  VISUAL_STYLE_LABELS,
  VISUAL_STYLE_TAXONOMY,
} from "../../packages/convex/shared/constants";
import {
  FILE_FORMATS,
  GENERIC_MIME_TYPES,
  MAX_FILE_NAME_LENGTH,
  MAX_FILE_SIZE,
} from "../../packages/convex/shared/fileFormats";
import { FOLDER_ERROR_MESSAGES } from "../../packages/convex/shared/folders";
import {
  ACTIONABLE_LINK_CATEGORIES,
  LINK_CATEGORY_DONE_VERB,
} from "../../packages/convex/shared/linkCategories";
import { MARKDOWN_CONTENT_MAX_BYTES } from "../../packages/convex/shared/markdown";
import { SEARCH_TOKEN_TRIM_CHARACTERS } from "../../packages/convex/shared/search/constants";
import {
  CARD_TYPE_ALIASES,
  SEARCH_IS_WORDS,
  SEARCH_QUALIFIER_KEYS,
} from "../../packages/convex/shared/search/qualifiers";
import {
  SEARCH_EXCLUDE_HINTS,
  SEARCH_IS_OPTIONS,
  SEARCH_OR_HINT,
  SEARCH_QUALIFIER_HINTS,
  SEARCH_SUGGESTION_GROUP_MESSAGE_KEYS,
} from "../../packages/convex/shared/search/suggestionHints";
import {
  HIDDEN_TAG_KEYS,
  MAX_BULK_TAGS,
  MAX_TAG_KEY_LENGTH,
  MAX_TAG_NAME_LENGTH,
  TAG_ERROR_MESSAGES,
} from "../../packages/convex/shared/tags";
import { VECTOR_QUERY_MAX_CHARS } from "../../packages/files-protocol/src/embeddings";
import {
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
} from "../../packages/i18n/src/locales";

/**
 * The swatch each color filter shows. The web shows colors by name only, so
 * the native apps keep this table here rather than in `packages/convex/shared`.
 */
export const COLOR_HUE_SWATCHES: Record<ColorHueBucket, string> = {
  red: "#EF4444",
  orange: "#F97316",
  yellow: "#EAB308",
  green: "#22C55E",
  teal: "#14B8A6",
  cyan: "#06B6D4",
  blue: "#3B82F6",
  purple: "#A855F7",
  pink: "#EC4899",
  brown: "#92400E",
  neutral: "#737373",
};

const sortedRecord = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  );

export const buildNativeConstants = () => ({
  cardTypes: [...cardTypes],
  cardTypeLabels: CARD_TYPE_LABELS,
  cardTypeAliases: sortedRecord(CARD_TYPE_ALIASES),
  limits: {
    freeTierCards: FREE_TIER_LIMIT,
    maxFileSize: MAX_FILE_SIZE,
    maxFilesPerUpload: MAX_FILES_PER_UPLOAD,
    maxFileNameLength: MAX_FILE_NAME_LENGTH,
    markdownContentMaxBytes: MARKDOWN_CONTENT_MAX_BYTES,
    maxTagNameLength: MAX_TAG_NAME_LENGTH,
    maxTagKeyLength: MAX_TAG_KEY_LENGTH,
    maxBulkCardIds: MAX_BULK_CARD_IDS,
    maxBulkTags: MAX_BULK_TAGS,
    cardLinkTitleMaxLength: CARD_LINK_TITLE_MAX_LENGTH,
    maxCardLinks: MAX_CARD_LINKS,
    semanticQueryMaxChars: VECTOR_QUERY_MAX_CHARS,
  },
  messages: {
    signupsPaused: SIGNUPS_PAUSED_MESSAGE,
  },
  cardErrorMessages: CARD_ERROR_MESSAGES,
  tagErrorMessages: TAG_ERROR_MESSAGES,
  folderErrorMessages: FOLDER_ERROR_MESSAGES,
  hiddenTagKeys: [...HIDDEN_TAG_KEYS],
  linkCategoryDoneVerbs: sortedRecord(LINK_CATEGORY_DONE_VERB),
  actionableLinkCategories: [...ACTIONABLE_LINK_CATEGORIES].sort(),
  bulkCardActions: bulkCardActionValidator.members.map(
    (member) => member.value
  ),
  visualStyles: [...VISUAL_STYLE_TAXONOMY],
  visualStyleLabels: VISUAL_STYLE_LABELS,
  visualStyleAliases: sortedRecord(VISUAL_STYLE_ALIAS_MAP),
  colorHues: [...COLOR_HUE_BUCKETS],
  colorHueLabels: COLOR_HUE_LABELS,
  colorHueAliases: sortedRecord(COLOR_HUE_ALIAS_MAP),
  colorHueSwatches: COLOR_HUE_SWATCHES,
  genericMimeTypes: [...GENERIC_MIME_TYPES].sort(),
  cardLinkTokenPattern: CARD_LINK_PATTERN.source,
  searchQualifierKeys: [...SEARCH_QUALIFIER_KEYS],
  searchIsWords: SEARCH_IS_WORDS,
  searchTokenTrimCharacters: SEARCH_TOKEN_TRIM_CHARACTERS,
  searchSuggestionHints: {
    qualifiers: SEARCH_QUALIFIER_HINTS,
    exclude: SEARCH_EXCLUDE_HINTS,
    or: SEARCH_OR_HINT,
    isOptions: SEARCH_IS_OPTIONS,
    groups: SEARCH_SUGGESTION_GROUP_MESSAGE_KEYS,
  },
  locales: SUPPORTED_LOCALES.map((id) => ({
    id,
    name: LOCALE_NAMES[id].native,
  })),
  fileFormats: FILE_FORMATS.map((format) => ({
    id: format.id,
    cardType: format.cardType,
    extension: format.extension,
    kind: format.kind,
    language: "language" in format ? format.language : undefined,
    mimeType: format.mimeType,
    mimeTypes: [...format.mimeTypes],
    preview: format.preview,
    suffixes: [...format.suffixes],
    fileNames: "fileNames" in format ? [...format.fileNames] : undefined,
  })),
});

export type NativeConstants = ReturnType<typeof buildNativeConstants>;
