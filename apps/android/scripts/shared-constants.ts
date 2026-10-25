/**
 * Regenerate after changing these constants in packages/convex/shared:
 *   bun --no-env-file run apps/android/scripts/shared-constants.ts --write
 */
import { resolve } from "node:path";
import {
  MAX_BULK_CARD_IDS,
  MAX_BULK_TAGS,
} from "../../../packages/convex/card/bulkActions";
import {
  CARD_LINK_TITLE_MAX_LENGTH,
  MAX_CARD_LINKS,
} from "../../../packages/convex/shared/cardLinks";
import {
  CARD_TYPE_LABELS,
  COLOR_HUE_BUCKETS,
  COLOR_HUE_LABELS,
  cardTypes,
  FREE_TIER_LIMIT,
  MAX_FILES_PER_UPLOAD,
  SIGNUPS_PAUSED_MESSAGE,
} from "../../../packages/convex/shared/constants";
import { MAX_FILE_SIZE } from "../../../packages/convex/shared/fileFormats";
import {
  ACTIONABLE_LINK_CATEGORIES,
  LINK_CATEGORY_DONE_VERB,
} from "../../../packages/convex/shared/linkCategories";
import { SEARCH_TOKEN_TRIM_CHARACTERS } from "../../../packages/convex/shared/search/constants";
import { SEARCH_QUALIFIER_KEYS } from "../../../packages/convex/shared/search/qualifiers";
import {
  HIDDEN_TAG_KEYS,
  MAX_TAG_KEY_LENGTH,
  MAX_TAG_NAME_LENGTH,
  TAG_ERROR_MESSAGES,
} from "../../../packages/convex/shared/tags";
import { VECTOR_QUERY_MAX_CHARS } from "../../../packages/files-protocol/src/embeddings";
import {
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
} from "../../../packages/i18n/src/locales";

export const SHARED_CONSTANTS_PATH = resolve(
  import.meta.dir,
  "../core/model/src/main/kotlin/com/praveenjuge/teak/core/model/SharedConstants.kt"
);

const kotlinString = (value: string) =>
  JSON.stringify(value).replaceAll("$", "\\$");

const kotlinList = (values: readonly string[]) =>
  `listOf(\n${values.map((value) => `    ${kotlinString(value)},`).join("\n")}\n)`;

const kotlinMap = (record: Record<string, string>) =>
  `mapOf(\n${Object.entries(record)
    .map(
      ([key, value]) => `    ${kotlinString(key)} to ${kotlinString(value)},`
    )
    .join("\n")}\n)`;

export const renderSharedConstants = () =>
  [
    "package com.praveenjuge.teak.core.model",
    "",
    `const val FREE_TIER_LIMIT = ${FREE_TIER_LIMIT}`,
    "",
    `const val MAX_FILE_SIZE: Long = ${MAX_FILE_SIZE}L`,
    "",
    `const val MAX_FILES_PER_UPLOAD = ${MAX_FILES_PER_UPLOAD}`,
    "",
    `const val SIGNUPS_PAUSED_MESSAGE = ${kotlinString(SIGNUPS_PAUSED_MESSAGE)}`,
    "",
    `val CARD_TYPES: List<String> = ${kotlinList(cardTypes)}`,
    "",
    `val CARD_TYPE_LABELS: Map<String, String> = ${kotlinMap(CARD_TYPE_LABELS)}`,
    "",
    `val COLOR_HUE_BUCKETS: List<String> = ${kotlinList(COLOR_HUE_BUCKETS)}`,
    "",
    `val COLOR_HUE_LABELS: Map<String, String> = ${kotlinMap(COLOR_HUE_LABELS)}`,
    "",
    `const val MAX_TAG_NAME_LENGTH = ${MAX_TAG_NAME_LENGTH}`,
    "",
    `val TAG_ERROR_MESSAGES: Map<String, String> = ${kotlinMap(TAG_ERROR_MESSAGES)}`,
    "",
    `val HIDDEN_TAG_KEYS: List<String> = ${kotlinList(HIDDEN_TAG_KEYS)}`,
    "",
    `val LINK_CATEGORY_DONE_VERBS: Map<String, String> = ${kotlinMap(LINK_CATEGORY_DONE_VERB)}`,
    "",
    `val ACTIONABLE_LINK_CATEGORIES: List<String> = ${kotlinList([...ACTIONABLE_LINK_CATEGORIES].sort())}`,
    "",
    `const val MAX_TAG_KEY_LENGTH = ${MAX_TAG_KEY_LENGTH}`,
    "",
    `const val MAX_BULK_CARD_IDS = ${MAX_BULK_CARD_IDS}`,
    "",
    `const val MAX_BULK_TAGS = ${MAX_BULK_TAGS}`,
    "",
    `const val SEMANTIC_QUERY_MAX_CHARS = ${VECTOR_QUERY_MAX_CHARS}`,
    "",
    `const val CARD_LINK_TITLE_MAX_LENGTH = ${CARD_LINK_TITLE_MAX_LENGTH}`,
    "",
    `const val MAX_CARD_LINKS = ${MAX_CARD_LINKS}`,
    "",
    `const val SEARCH_TOKEN_TRIM_CHARACTERS = ${kotlinString(SEARCH_TOKEN_TRIM_CHARACTERS)}`,
    "",
    `val SEARCH_QUALIFIER_KEYS: List<String> = ${kotlinList(SEARCH_QUALIFIER_KEYS)}`,
    "",
    "/** Teak's languages, in the order the Language setting lists them, each in its own name. */",
    `val LOCALE_NAMES: Map<String, String> = ${kotlinMap(
      Object.fromEntries(
        SUPPORTED_LOCALES.map((locale) => [locale, LOCALE_NAMES[locale].native])
      )
    )}`,
    "",
  ].join("\n");

if (import.meta.main) {
  if (process.argv.includes("--write")) {
    await Bun.write(SHARED_CONSTANTS_PATH, renderSharedConstants());
    console.log(`Wrote ${SHARED_CONSTANTS_PATH}`);
  } else {
    process.stdout.write(renderSharedConstants());
  }
}
