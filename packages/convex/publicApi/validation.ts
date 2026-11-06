/**
 * Input checks the public API's mutations and its HTTP layer share. They know
 * nothing of requests or responses: each returns the reason an input is
 * refused, or the cleaned value.
 */
import { MAX_CARD_TITLE_LENGTH } from "../shared/cardTitle";
import {
  MARKDOWN_CONTENT_MAX_BYTES,
  MARKDOWN_CONTENT_TOO_LARGE_MESSAGE,
  markdownContentByteLength,
} from "../shared/markdown";
import { CARD_TAG_ERROR_MESSAGES, MAX_TAG_NAME_LENGTH } from "../shared/tags";
import { extractPaletteColors } from "../shared/utils/colorUtils";

const FILE_CARD_TYPES = ["image", "video", "audio", "document"] as const;

const truncateCardTitle = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  let title = value.trim();
  if (title.length > MAX_CARD_TITLE_LENGTH) {
    title = title.slice(0, MAX_CARD_TITLE_LENGTH);
    if (/[\uD800-\uDBFF]$/.test(title)) {
      title = title.slice(0, -1);
    }
    title = title.trimEnd();
  }
  return title;
};

const explainInvalidTags = (tags: readonly string[] | undefined) =>
  tags?.some((tag) => tag.trim().length > MAX_TAG_NAME_LENGTH)
    ? CARD_TAG_ERROR_MESSAGES.TAG_TOO_LONG
    : null;

const NOTES_MAX_BYTES = 256 * 1024;

const exceedsBytes = (value: unknown, limit: number): boolean =>
  typeof value === "string" &&
  // UTF-8 takes at most 3 bytes per UTF-16 unit, so short text skips the
  // encode.
  value.length * 3 > limit &&
  markdownContentByteLength(value) > limit;

/**
 * Content keeps the 512 KiB a text card's content has, on every card type, and
 * notes get 256 KiB. Together they stay well inside Convex's 1 MiB document,
 * so a card that passes can be stored next to its other fields instead of
 * failing with an internal error.
 */
const explainOversizedText = (fields: {
  content?: unknown;
  notes?: unknown;
}): string | null => {
  if (exceedsBytes(fields.content, MARKDOWN_CONTENT_MAX_BYTES)) {
    // The message text cards have always answered with.
    return MARKDOWN_CONTENT_TOO_LARGE_MESSAGE;
  }
  if (exceedsBytes(fields.notes, NOTES_MAX_BYTES)) {
    return "Notes must not exceed 256 KiB when encoded as UTF-8.";
  }
  return null;
};

const explainCardTypeMismatch = (args: {
  cardType?: string;
  content?: string;
  notes?: string | null;
  tags?: readonly string[];
}): string | null => {
  if (!args.cardType) {
    return null;
  }
  if ((FILE_CARD_TYPES as readonly string[]).includes(args.cardType)) {
    return `\`cardType\` \`${args.cardType}\` needs an uploaded file. Upload it with POST /v1/uploads first.`;
  }
  if (args.cardType === "palette") {
    const paletteText = [args.content, args.notes, args.tags?.join(" ")]
      .filter(Boolean)
      .join("\n");
    if (extractPaletteColors(paletteText, 1).length === 0) {
      return "A `palette` card needs at least one color, such as #ff5500";
    }
  }
  return null;
};

const parseOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const parseOptionalNullableString = (
  value: unknown
): string | null | undefined => {
  if (value === null) {
    return null;
  }

  return parseOptionalString(value);
};

const parseStringArray = (value: unknown): string[] | undefined => {
  if (
    !(Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  ) {
    return;
  }

  const normalized = Array.from(
    new Set(value.map((entry) => entry.trim()).filter(Boolean))
  );

  return normalized.length > 0 ? normalized : [];
};

export {
  explainCardTypeMismatch,
  explainInvalidTags,
  explainOversizedText,
  parseOptionalNullableString,
  parseOptionalString,
  parseStringArray,
  truncateCardTitle,
};
