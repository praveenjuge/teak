import {
  explainInvalidCardSource,
  normalizeCardSource,
} from "../../shared/cardSource";
import { parseCardTitle } from "../../shared/cardTitle";
import { MAX_FOLDERS_PER_CARD } from "../../shared/folders";
import { PUBLIC_API_CARD_TYPES } from "../../shared/publicApiContract";
import { MAX_PALETTE_COLORS } from "../../shared/utils/colorUtils";
import { isSafeExternalUrl } from "../../shared/utils/safeUrl";
import {
  explainCardTypeMismatch,
  explainInvalidTags,
  explainOversizedText,
  parseOptionalNullableString,
  parseOptionalString,
  parseStringArray,
} from "../validation";
import type { CreateCardPayload } from "./shared";

type CreatePayloadResult =
  | { code?: "CONTENT_TOO_LARGE"; error: string }
  | { payload: CreateCardPayload };

const CREATE_KEYS = new Set([
  "cardType",
  "content",
  "fileEtag",
  "fileKey",
  "fileName",
  "fileSize",
  "mimeType",
  "notes",
  "pageSnapshotKey",
  "source",
  "sourceTitle",
  "sourceUrl",
  "tags",
  "url",
]);

const CREATE_STRING_KEYS = [
  "cardType",
  "content",
  "fileEtag",
  "fileKey",
  "fileName",
  "mimeType",
  "pageSnapshotKey",
  "source",
  "sourceTitle",
  "sourceUrl",
  "url",
] as const;

export const parseCreatePayload = (payload: unknown): CreatePayloadResult => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Body must be a JSON object" };
  }

  const source = payload as Record<string, unknown>;
  const unknownKey = Object.keys(source).find((key) => !CREATE_KEYS.has(key));
  if (unknownKey !== undefined) {
    return { error: `Unknown field \`${unknownKey}\`` };
  }

  const wrongTypeKey = CREATE_STRING_KEYS.find(
    (key) => source[key] !== undefined && typeof source[key] !== "string"
  );
  if (wrongTypeKey !== undefined) {
    return { error: `\`${wrongTypeKey}\` must be a string` };
  }

  const content =
    typeof source.content === "string" ? source.content : undefined;
  const url = parseOptionalString(source.url);
  const fileKey = parseOptionalString(source.fileKey);
  const fileEtag = parseOptionalString(source.fileEtag);
  const fileName = parseOptionalString(source.fileName);
  const mimeType = parseOptionalString(source.mimeType);
  const cardType = parseOptionalString(source.cardType);
  const notes = parseOptionalNullableString(source.notes);
  const pageSnapshotKey = parseOptionalString(source.pageSnapshotKey);
  const sourceValue = parseOptionalString(source.source);
  const cardSource = {
    sourceTitle: source.sourceTitle as string | undefined,
    sourceUrl: source.sourceUrl as string | undefined,
  };
  const tags =
    source.tags === undefined ? undefined : parseStringArray(source.tags);

  if (source.tags !== undefined && tags === undefined) {
    return { error: "`tags` must be an array of strings" };
  }
  const tagError = explainInvalidTags(tags);
  if (tagError) {
    return { error: tagError };
  }
  if (url !== undefined && !isSafeExternalUrl(url)) {
    return { error: "`url` must use the http or https scheme" };
  }
  const sourceError = explainInvalidCardSource(cardSource);
  if (sourceError) {
    return { error: sourceError };
  }
  if (
    cardType !== undefined &&
    !(PUBLIC_API_CARD_TYPES as readonly string[]).includes(cardType)
  ) {
    return {
      error: `\`cardType\` must be one of: ${PUBLIC_API_CARD_TYPES.join(", ")}`,
    };
  }
  if (
    source.fileSize !== undefined &&
    !(typeof source.fileSize === "number" && Number.isFinite(source.fileSize))
  ) {
    return { error: "`fileSize` must be a number" };
  }
  const fileSize = source.fileSize as number | undefined;

  if (
    source.notes !== undefined &&
    !(typeof source.notes === "string" || source.notes === null)
  ) {
    return { error: "`notes` must be a string or null" };
  }
  const oversized = explainOversizedText(source);
  if (oversized) {
    return { code: "CONTENT_TOO_LARGE", error: oversized };
  }

  if (fileKey) {
    if (!(fileName && mimeType)) {
      return { error: "An uploaded file needs `fileName` and `mimeType`" };
    }
    if (url) {
      return { error: "Send either `fileKey` or `url`, not both" };
    }
    if (cardSource.sourceUrl !== undefined) {
      return { error: "`sourceUrl` can't be sent with an uploaded `fileKey`" };
    }
    if (pageSnapshotKey !== undefined) {
      return {
        error: "`pageSnapshotKey` can't be sent with an uploaded `fileKey`",
      };
    }
    return {
      payload: {
        cardType,
        content,
        fileEtag,
        fileKey,
        fileName,
        fileSize,
        mimeType,
        notes,
        source: sourceValue,
        tags,
      },
    };
  }

  if (fileName || mimeType) {
    return { error: "`fileName` and `mimeType` need an uploaded `fileKey`" };
  }
  if (content === undefined && !url) {
    return { error: "Body must include `content` or `url`" };
  }
  if (cardType !== "text" && !url && !content?.trim()) {
    return {
      error: "`content` cannot be blank unless `cardType` is `text`",
    };
  }
  const typeError = explainCardTypeMismatch({ cardType, content, notes, tags });
  if (typeError) {
    return { error: typeError };
  }

  return {
    payload: {
      cardType,
      content,
      notes,
      ...(pageSnapshotKey ? { pageSnapshotKey } : {}),
      source: sourceValue,
      ...normalizeCardSource(cardSource),
      tags,
      url,
    },
  };
};

export const validateCreatePayload = (
  payload: unknown
): CreateCardPayload | null => {
  const result = parseCreatePayload(payload);
  return "payload" in result ? result.payload : null;
};

interface PatchCardPayload {
  addColors?: string[];
  content?: string;
  folderIds?: string[];
  isArchived?: boolean;
  metadataTitle?: string | null;
  notes?: string | null;
  removeAiTags?: string[];
  removeColors?: string[];
  tags?: string[];
  url?: string;
}

const PATCH_FIELDS =
  "content, url, metadataTitle, notes, tags, removeAiTags, addColors, removeColors, isArchived, folderIds";

type PatchPayloadResult =
  | { code?: "CONTENT_TOO_LARGE"; error: string }
  | { payload: PatchCardPayload };

const parsePaletteColorList = (value: unknown): string[] | undefined => {
  const colors = parseStringArray(value);
  return colors?.length && colors.length <= MAX_PALETTE_COLORS
    ? colors
    : undefined;
};

const explainPaletteColorList = (field: "addColors" | "removeColors") =>
  `\`${field}\` must be a list of 1 to ${MAX_PALETTE_COLORS} hex codes`;

export const parsePatchPayload = (payload: unknown): PatchPayloadResult => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Body must be a JSON object" };
  }

  const source = payload as Record<string, unknown>;
  const allowedKeys = new Set([
    "addColors",
    "content",
    "folderIds",
    "isArchived",
    "metadataTitle",
    "notes",
    "removeAiTags",
    "removeColors",
    "tags",
    "url",
  ]);

  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) {
      return {
        error: `Unknown field \`${key}\`; a card takes ${PATCH_FIELDS}`,
      };
    }
  }

  const next: PatchCardPayload = {};

  if ("content" in source) {
    if (typeof source.content !== "string") {
      return { error: "`content` must be a string" };
    }
    next.content = source.content;
  }

  if ("url" in source) {
    if (typeof source.url !== "string" || !source.url.trim()) {
      return { error: "`url` must be a non-empty string" };
    }
    const trimmedUrl = source.url.trim();
    if (!isSafeExternalUrl(trimmedUrl)) {
      return { error: "`url` must use the http or https scheme" };
    }
    next.url = trimmedUrl;
  }

  if ("metadataTitle" in source) {
    const parsed = parseCardTitle(source.metadataTitle);
    if (parsed.kind === "invalid") {
      return { error: "`metadataTitle` must be a string or null" };
    }
    next.metadataTitle = parsed.kind === "title" ? parsed.title : null;
  }

  if ("notes" in source) {
    if (!(typeof source.notes === "string" || source.notes === null)) {
      return { error: "`notes` must be a string or null" };
    }
    next.notes =
      typeof source.notes === "string" ? source.notes.trim() || null : null;
  }

  const oversized = explainOversizedText(next);
  if (oversized) {
    return { code: "CONTENT_TOO_LARGE", error: oversized };
  }

  if ("tags" in source) {
    const tags = parseStringArray(source.tags);
    if (tags === undefined) {
      return { error: "`tags` must be an array of strings" };
    }
    const tagError = explainInvalidTags(tags);
    if (tagError) {
      return { error: tagError };
    }
    next.tags = tags;
  }

  if ("removeAiTags" in source) {
    const removeAiTags = parseStringArray(source.removeAiTags);
    if (!removeAiTags?.length) {
      return { error: "`removeAiTags` must be a non-empty array of strings" };
    }
    next.removeAiTags = removeAiTags;
  }

  if ("addColors" in source) {
    const colors = parsePaletteColorList(source.addColors);
    if (!colors) {
      return { error: explainPaletteColorList("addColors") };
    }
    next.addColors = colors;
  }

  if ("removeColors" in source) {
    const colors = parsePaletteColorList(source.removeColors);
    if (!colors) {
      return { error: explainPaletteColorList("removeColors") };
    }
    next.removeColors = colors;
  }

  if ("isArchived" in source) {
    if (typeof source.isArchived !== "boolean") {
      return { error: "`isArchived` must be true or false" };
    }
    next.isArchived = source.isArchived;
  }

  if ("folderIds" in source) {
    const folderIds = parseStringArray(source.folderIds);
    if (folderIds === undefined || folderIds.some((id) => id.length > 64)) {
      return { error: "`folderIds` must be an array of folder ids" };
    }
    if (folderIds.length > MAX_FOLDERS_PER_CARD) {
      return {
        error: `A card can be in at most ${MAX_FOLDERS_PER_CARD} folders`,
      };
    }
    next.folderIds = folderIds;
  }

  if (Object.keys(next).length === 0) {
    return { error: `Body must include at least one of ${PATCH_FIELDS}` };
  }

  return { payload: next };
};

export const validatePatchPayload = (
  payload: unknown
): PatchCardPayload | null => {
  const result = parsePatchPayload(payload);
  return "payload" in result ? result.payload : null;
};
