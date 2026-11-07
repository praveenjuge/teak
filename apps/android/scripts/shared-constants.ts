/**
 * Regenerate after changing a value in scripts/repo/native-constants.ts or the
 * `packages/convex/shared` code it reads:
 *   bun --no-env-file run apps/android/scripts/shared-constants.ts --write
 */
import { resolve } from "node:path";
import type { SearchSuggestionHint } from "../../../packages/convex/shared/search/suggestionHints";
import {
  buildNativeConstants,
  type NativeConstants,
} from "../../../scripts/repo/native-constants";

export const SHARED_CONSTANTS_PATH = resolve(
  import.meta.dir,
  "../core/model/src/main/kotlin/com/praveenjuge/teak/core/model/SharedConstants.kt"
);

/** Kotlin names that don't follow from the manifest key. */
const KOTLIN_NAMES: Record<string, string> = {
  "limits.freeTierCards": "FREE_TIER_LIMIT",
  "messages.signupsPaused": "SIGNUPS_PAUSED_MESSAGE",
  colorHues: "COLOR_HUE_BUCKETS",
  "searchSuggestionHints.qualifiers": "SEARCH_QUALIFIER_HINTS",
  "searchSuggestionHints.exclude": "SEARCH_EXCLUDE_HINTS",
  "searchSuggestionHints.or": "SEARCH_OR_HINT",
  "searchSuggestionHints.isOptions": "SEARCH_IS_OPTIONS",
  "searchSuggestionHints.groups": "SEARCH_SUGGESTION_GROUPS",
  locales: "LOCALE_NAMES",
};

/** Byte counts the app compares with file sizes, which are `Long`. */
const LONG_VALUES = new Set(["limits.maxFileSize"]);

const GROUPS = new Set(["limits", "messages", "searchSuggestionHints"]);

const screamingSnake = (key: string) =>
  key.replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();

const kotlinString = (value: string) =>
  JSON.stringify(value).replaceAll("$", "\\$");

const kotlinOptionalString = (value: string | undefined) =>
  value === undefined ? "null" : kotlinString(value);

const kotlinStrings = (values: readonly string[]) =>
  `listOf(${values.map(kotlinString).join(", ")})`;

const kotlinList = (values: readonly string[]) =>
  `listOf(\n${values.map((value) => `    ${kotlinString(value)},`).join("\n")}\n)`;

const kotlinMap = (record: Record<string, string>) =>
  `mapOf(\n${Object.entries(record)
    .map(
      ([key, value]) => `    ${kotlinString(key)} to ${kotlinString(value)},`
    )
    .join("\n")}\n)`;

const kotlinListMap = (record: Record<string, readonly string[]>) =>
  `mapOf(\n${Object.entries(record)
    .map(
      ([key, value]) => `    ${kotlinString(key)} to ${kotlinStrings(value)},`
    )
    .join("\n")}\n)`;

const kotlinHint = (hint: SearchSuggestionHint) =>
  `SearchHint(id = ${kotlinString(hint.id)}, group = ${kotlinString(hint.group)}, key = ${kotlinString(hint.key)}, insert = ${kotlinString(hint.insert)}, messageKey = ${kotlinString(hint.messageKey)})`;

const kotlinHints = (hints: readonly SearchSuggestionHint[]) =>
  `listOf(\n${hints.map((hint) => `    ${kotlinHint(hint)},`).join("\n")}\n)`;

const kotlinIsOptions = (
  options: NativeConstants["searchSuggestionHints"]["isOptions"]
) =>
  `listOf(\n${options
    .map(
      (option) =>
        `    SearchIsOption(value = ${kotlinString(option.value)}, words = ${kotlinStrings(option.words)}, messageKey = ${kotlinString(option.messageKey)}),`
    )
    .join("\n")}\n)`;

const kotlinFileFormats = (formats: NativeConstants["fileFormats"]) =>
  `listOf(\n${formats
    .map(
      (format) =>
        `    FileFormatSpec(id = ${kotlinString(format.id)}, cardType = ${kotlinString(format.cardType)}, extension = ${kotlinString(format.extension)}, kind = ${kotlinString(format.kind)}, language = ${kotlinOptionalString(format.language)}, mimeType = ${kotlinString(format.mimeType)}, mimeTypes = ${kotlinStrings(format.mimeTypes)}, preview = ${kotlinString(format.preview)}, suffixes = ${kotlinStrings(format.suffixes)}, fileNames = ${format.fileNames ? kotlinStrings(format.fileNames) : "null"}),`
    )
    .join("\n")}\n)`;

const isStringRecord = (value: object): value is Record<string, string> =>
  Object.values(value).every((entry) => typeof entry === "string");

const isListRecord = (
  value: object
): value is Record<string, readonly string[]> =>
  Object.values(value).every(
    (entry) =>
      Array.isArray(entry) && entry.every((item) => typeof item === "string")
  );

/** One Kotlin declaration for a manifest value, chosen by the value's shape. */
const declaration = (path: string, value: unknown): string => {
  const name =
    KOTLIN_NAMES[path] ?? screamingSnake(path.split(".").at(-1) ?? path);
  if (typeof value === "number") {
    return LONG_VALUES.has(path)
      ? `const val ${name}: Long = ${value}L`
      : `const val ${name} = ${value}`;
  }
  if (typeof value === "string") {
    return `const val ${name} = ${kotlinString(value)}`;
  }
  switch (path) {
    case "searchSuggestionHints.qualifiers":
    case "searchSuggestionHints.exclude":
      return `val ${name}: List<SearchHint> = ${kotlinHints(value as SearchSuggestionHint[])}`;
    case "searchSuggestionHints.or":
      return `val ${name}: SearchHint = ${kotlinHint(value as SearchSuggestionHint)}`;
    case "searchSuggestionHints.isOptions":
      return `val ${name}: List<SearchIsOption> = ${kotlinIsOptions(value as NativeConstants["searchSuggestionHints"]["isOptions"])}`;
    case "locales":
      return `val ${name}: Map<String, String> = ${kotlinMap(
        Object.fromEntries(
          (value as NativeConstants["locales"]).map((locale) => [
            locale.id,
            locale.name,
          ])
        )
      )}`;
    case "fileFormats":
      return `val ${name}: List<FileFormatSpec> = ${kotlinFileFormats(value as NativeConstants["fileFormats"])}`;
    default:
      break;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return `val ${name}: List<String> = ${kotlinList(value)}`;
  }
  if (value && typeof value === "object" && isStringRecord(value)) {
    return `val ${name}: Map<String, String> = ${kotlinMap(value)}`;
  }
  if (value && typeof value === "object" && isListRecord(value)) {
    return `val ${name}: Map<String, List<String>> = ${kotlinListMap(value)}`;
  }
  throw new Error(`No Kotlin form for ${path}`);
};

const declarations = (constants: NativeConstants) =>
  Object.entries(constants).flatMap(([key, value]) =>
    GROUPS.has(key)
      ? Object.entries(value as Record<string, unknown>).map(([inner, entry]) =>
          declaration(`${key}.${inner}`, entry)
        )
      : [declaration(key, value)]
  );

const FILE_FORMAT_SPEC = `/** One entry of the backend's file format registry (\`FILE_FORMATS\` in packages/convex/shared/fileFormats.ts). */
data class FileFormatSpec(
    val id: String,
    val cardType: String,
    val extension: String,
    val kind: String,
    val language: String?,
    val mimeType: String,
    val mimeTypes: List<String>,
    val preview: String,
    val suffixes: List<String>,
    val fileNames: List<String>?,
)`;

export const renderSharedConstants = () =>
  [
    "// Generated by apps/android/scripts/shared-constants.ts from scripts/repo/native-constants.ts. Do not edit.",
    "package com.praveenjuge.teak.core.model",
    "",
    FILE_FORMAT_SPEC,
    "",
    ...declarations(buildNativeConstants()).flatMap((line) => [line, ""]),
  ].join("\n");

if (import.meta.main) {
  if (process.argv.includes("--write")) {
    await Bun.write(SHARED_CONSTANTS_PATH, renderSharedConstants());
    console.log(`Wrote ${SHARED_CONSTANTS_PATH}`);
  } else {
    process.stdout.write(renderSharedConstants());
  }
}
