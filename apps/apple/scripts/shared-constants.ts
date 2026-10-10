/**
 * The backend constants the Apple app needs, as JSON. TeakCore reads the
 * committed file at runtime, so limits, messages, colors, styles and file
 * formats have one source: `packages/convex/shared`.
 *
 * Regenerate after changing those constants:
 *   bun --no-env-file run apps/apple/scripts/shared-constants.ts --write
 */
import { resolve } from "node:path";
import {
  ACCOUNT_CHANGES_PAUSED_MESSAGE,
  CARD_ERROR_MESSAGES,
  CARD_TYPE_LABELS,
  COLOR_HUE_ALIAS_MAP,
  COLOR_HUE_BUCKETS,
  COLOR_HUE_LABELS,
  cardTypes,
  FREE_TIER_LIMIT,
  MAX_FILES_PER_UPLOAD,
  SIGNUPS_PAUSED_MESSAGE,
  VISUAL_STYLE_ALIAS_MAP,
  VISUAL_STYLE_LABELS,
  VISUAL_STYLE_TAXONOMY,
} from "../../../packages/convex/shared/constants";
import {
  FILE_FORMATS,
  GENERIC_MIME_TYPES,
  MAX_FILE_NAME_LENGTH,
  MAX_FILE_SIZE,
} from "../../../packages/convex/shared/fileFormats";
import { MARKDOWN_CONTENT_MAX_BYTES } from "../../../packages/convex/shared/markdown";

export const SHARED_CONSTANTS_PATH = resolve(
  import.meta.dir,
  "../Packages/TeakKit/Sources/TeakCore/Resources/SharedConstants.json"
);

const sortedRecord = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  );

export const buildSharedConstants = () => ({
  cardTypes: [...cardTypes],
  cardTypeLabels: CARD_TYPE_LABELS,
  limits: {
    freeTierCards: FREE_TIER_LIMIT,
    maxFileSize: MAX_FILE_SIZE,
    maxFilesPerUpload: MAX_FILES_PER_UPLOAD,
    maxFileNameLength: MAX_FILE_NAME_LENGTH,
    markdownContentMaxBytes: MARKDOWN_CONTENT_MAX_BYTES,
  },
  messages: {
    signupsPaused: SIGNUPS_PAUSED_MESSAGE,
    accountChangesPaused: ACCOUNT_CHANGES_PAUSED_MESSAGE,
  },
  cardErrorMessages: CARD_ERROR_MESSAGES,
  visualStyles: [...VISUAL_STYLE_TAXONOMY],
  visualStyleLabels: VISUAL_STYLE_LABELS,
  visualStyleAliases: sortedRecord(VISUAL_STYLE_ALIAS_MAP),
  colorHues: [...COLOR_HUE_BUCKETS],
  colorHueLabels: COLOR_HUE_LABELS,
  colorHueAliases: sortedRecord(COLOR_HUE_ALIAS_MAP),
  genericMimeTypes: [...GENERIC_MIME_TYPES].sort(),
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

export const renderSharedConstants = () =>
  `${JSON.stringify(buildSharedConstants(), null, 2)}\n`;

if (import.meta.main) {
  if (process.argv.includes("--write")) {
    await Bun.write(SHARED_CONSTANTS_PATH, renderSharedConstants());
    console.log(`Wrote ${SHARED_CONSTANTS_PATH}`);
  } else {
    process.stdout.write(renderSharedConstants());
  }
}
