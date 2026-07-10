import type { CardType } from "./constants";

export const FILE_KINDS = [
  "archive",
  "audio",
  "design",
  "image",
  "markdown",
  "motion",
  "office",
  "pdf",
  "source",
  "text",
  "tokens",
] as const;

export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_PREVIEW_KINDS = [
  "archive",
  "audio",
  "facts",
  "image",
  "markdown",
  "motion",
  "office",
  "pdf",
  "source",
] as const;

export type FilePreviewKind = (typeof FILE_PREVIEW_KINDS)[number];

export interface FileFormat {
  cardType: Extract<CardType, "audio" | "document" | "image" | "video">;
  extension: string;
  id: string;
  kind: FileKind;
  language?: string;
  mimeType: string;
  mimeTypes: readonly string[];
  preview: FilePreviewKind;
}

interface FileFormatDefinition extends FileFormat {
  fileNames?: readonly string[];
  suffixes: readonly string[];
}

export interface FilePreviewFacts {
  animated?: boolean;
  archiveDirectoryCount?: number;
  archiveFileCount?: number;
  colorVariableCount?: number;
  inspectedEntryCount?: number;
  slideCount?: number;
}

export const MAX_FILE_NAME_LENGTH = 240;
export const MAX_FILE_SIZE = 100 * 1024 * 1024;

const GENERIC_MIME_TYPES = new Set([
  "",
  "application/binary",
  "application/octet-stream",
  "binary/octet-stream",
]);

export const isGenericMimeType = (
  mimeType: string | null | undefined
): boolean => GENERIC_MIME_TYPES.has(normalizeMimeType(mimeType));

const MIME_TYPE_REGEX = /^[\w.+-]+\/[\w.+-]+$/u;
const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

const defineFormat = (
  definition: Omit<FileFormatDefinition, "mimeType"> & {
    mimeType?: string;
  }
): FileFormatDefinition => ({
  ...definition,
  mimeType: definition.mimeType ?? definition.mimeTypes[0] ?? "",
});

export const FILE_FORMATS = [
  defineFormat({
    id: "design-tokens",
    suffixes: ["tokens.json"],
    cardType: "document",
    extension: "tokens.json",
    kind: "tokens",
    language: "json",
    mimeTypes: ["application/json", "text/json", "text/plain"],
    preview: "source",
  }),
  defineFormat({
    id: "tailwind-config",
    fileNames: ["tailwind.config.js"],
    suffixes: [],
    cardType: "document",
    extension: "tailwind.config.js",
    kind: "source",
    language: "javascript",
    mimeTypes: [
      "application/javascript",
      "text/javascript",
      "application/x-javascript",
      "text/plain",
    ],
    preview: "source",
  }),
  defineFormat({
    id: "css-variables",
    fileNames: ["theme.css", "variables.css"],
    suffixes: [],
    cardType: "document",
    extension: "css",
    kind: "tokens",
    language: "css",
    mimeTypes: ["text/css", "text/plain"],
    preview: "source",
  }),
  defineFormat({
    id: "json",
    suffixes: ["json"],
    cardType: "document",
    extension: "json",
    kind: "source",
    language: "json",
    mimeTypes: ["application/json", "text/json", "application/ld+json"],
    preview: "source",
  }),
  defineFormat({
    id: "tsx",
    suffixes: ["tsx"],
    cardType: "document",
    extension: "tsx",
    kind: "source",
    language: "tsx",
    mimeTypes: [
      "text/tsx",
      "text/typescript",
      "application/typescript",
      "text/plain",
    ],
    preview: "source",
  }),
  defineFormat({
    id: "jsx",
    suffixes: ["jsx"],
    cardType: "document",
    extension: "jsx",
    kind: "source",
    language: "jsx",
    mimeTypes: [
      "text/jsx",
      "text/javascript",
      "application/javascript",
      "text/plain",
    ],
    preview: "source",
  }),
  defineFormat({
    id: "vue",
    suffixes: ["vue"],
    cardType: "document",
    extension: "vue",
    kind: "source",
    language: "markup",
    mimeTypes: ["text/x-vue", "application/x-vue", "text/plain"],
    preview: "source",
  }),
  defineFormat({
    id: "svelte",
    suffixes: ["svelte"],
    cardType: "document",
    extension: "svelte",
    kind: "source",
    language: "markup",
    mimeTypes: ["text/x-svelte", "application/x-svelte", "text/plain"],
    preview: "source",
  }),
  defineFormat({
    id: "html",
    suffixes: ["html", "htm"],
    cardType: "document",
    extension: "html",
    kind: "source",
    language: "markup",
    mimeTypes: ["text/html", "application/xhtml+xml", "text/plain"],
    preview: "source",
  }),
  defineFormat({
    id: "css",
    suffixes: ["css"],
    cardType: "document",
    extension: "css",
    kind: "source",
    language: "css",
    mimeTypes: ["text/css", "text/plain"],
    preview: "source",
  }),
  defineFormat({
    id: "markdown",
    suffixes: ["md", "markdown"],
    cardType: "document",
    extension: "md",
    kind: "markdown",
    language: "markdown",
    mimeTypes: ["text/markdown", "text/x-markdown", "text/plain"],
    preview: "markdown",
  }),
  defineFormat({
    id: "mdx",
    suffixes: ["mdx"],
    cardType: "document",
    extension: "mdx",
    kind: "markdown",
    language: "mdx",
    mimeTypes: ["text/mdx", "text/x-mdx", "text/markdown", "text/plain"],
    preview: "markdown",
  }),
  defineFormat({
    id: "text",
    suffixes: ["txt"],
    cardType: "document",
    extension: "txt",
    kind: "text",
    language: "text",
    mimeTypes: ["text/plain"],
    preview: "source",
  }),
  defineFormat({
    id: "rtf",
    suffixes: ["rtf"],
    cardType: "document",
    extension: "rtf",
    kind: "text",
    language: "text",
    mimeTypes: ["application/rtf", "text/rtf"],
    preview: "source",
  }),
  defineFormat({
    id: "pdf",
    suffixes: ["pdf"],
    cardType: "document",
    extension: "pdf",
    kind: "pdf",
    mimeTypes: ["application/pdf"],
    preview: "pdf",
  }),
  defineFormat({
    id: "word",
    suffixes: ["docx"],
    cardType: "document",
    extension: "docx",
    kind: "office",
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    preview: "office",
  }),
  defineFormat({
    id: "word-legacy",
    suffixes: ["doc"],
    cardType: "document",
    extension: "doc",
    kind: "office",
    mimeTypes: ["application/msword"],
    preview: "facts",
  }),
  defineFormat({
    id: "powerpoint",
    suffixes: ["pptx"],
    cardType: "document",
    extension: "pptx",
    kind: "office",
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    preview: "office",
  }),
  defineFormat({
    id: "powerpoint-legacy",
    suffixes: ["ppt"],
    cardType: "document",
    extension: "ppt",
    kind: "office",
    mimeTypes: ["application/vnd.ms-powerpoint"],
    preview: "facts",
  }),
  defineFormat({
    id: "excel",
    suffixes: ["xlsx"],
    cardType: "document",
    extension: "xlsx",
    kind: "office",
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    preview: "office",
  }),
  defineFormat({
    id: "excel-legacy",
    suffixes: ["xls"],
    cardType: "document",
    extension: "xls",
    kind: "office",
    mimeTypes: ["application/vnd.ms-excel"],
    preview: "facts",
  }),
  defineFormat({
    id: "csv",
    suffixes: ["csv"],
    cardType: "document",
    extension: "csv",
    kind: "text",
    language: "csv",
    mimeTypes: ["text/csv", "application/csv", "text/plain"],
    preview: "source",
  }),
  defineFormat({
    id: "zip",
    suffixes: ["zip"],
    cardType: "document",
    extension: "zip",
    kind: "archive",
    mimeTypes: ["application/zip", "application/x-zip-compressed"],
    preview: "archive",
  }),
  defineFormat({
    id: "figma",
    suffixes: ["fig"],
    cardType: "document",
    extension: "fig",
    kind: "design",
    mimeTypes: ["application/x-figma", "application/figma"],
    mimeType: "application/octet-stream",
    preview: "facts",
  }),
  defineFormat({
    id: "pages",
    suffixes: ["pages"],
    cardType: "document",
    extension: "pages",
    kind: "office",
    mimeTypes: ["application/vnd.apple.pages"],
    preview: "facts",
  }),
  defineFormat({
    id: "numbers",
    suffixes: ["numbers"],
    cardType: "document",
    extension: "numbers",
    kind: "office",
    mimeTypes: ["application/vnd.apple.numbers"],
    preview: "facts",
  }),
  defineFormat({
    id: "gif",
    suffixes: ["gif"],
    cardType: "video",
    extension: "gif",
    kind: "motion",
    mimeTypes: ["image/gif"],
    preview: "motion",
  }),
  defineFormat({
    id: "webm",
    suffixes: ["webm"],
    cardType: "video",
    extension: "webm",
    kind: "motion",
    mimeTypes: ["video/webm", "audio/webm"],
    preview: "motion",
  }),
  defineFormat({
    id: "mp4",
    suffixes: ["mp4"],
    cardType: "video",
    extension: "mp4",
    kind: "motion",
    mimeTypes: ["video/mp4", "application/mp4"],
    preview: "motion",
  }),
  defineFormat({
    id: "quicktime",
    suffixes: ["mov", "m4v"],
    cardType: "video",
    extension: "mov",
    kind: "motion",
    mimeTypes: ["video/quicktime", "video/x-m4v"],
    preview: "motion",
  }),
  defineFormat({
    id: "video",
    suffixes: ["mkv", "avi", "mpeg", "mpg", "wmv"],
    cardType: "video",
    extension: "video",
    kind: "motion",
    mimeTypes: [
      "video/x-matroska",
      "video/x-msvideo",
      "video/mpeg",
      "video/x-ms-wmv",
    ],
    preview: "motion",
  }),
  defineFormat({
    id: "png",
    suffixes: ["png"],
    cardType: "image",
    extension: "png",
    kind: "image",
    mimeTypes: ["image/png"],
    preview: "image",
  }),
  defineFormat({
    id: "jpeg",
    suffixes: ["jpg", "jpeg"],
    cardType: "image",
    extension: "jpg",
    kind: "image",
    mimeTypes: ["image/jpeg", "image/jpg", "image/pjpeg"],
    preview: "image",
  }),
  defineFormat({
    id: "webp",
    suffixes: ["webp"],
    cardType: "image",
    extension: "webp",
    kind: "image",
    mimeTypes: ["image/webp"],
    preview: "image",
  }),
  defineFormat({
    id: "avif",
    suffixes: ["avif"],
    cardType: "image",
    extension: "avif",
    kind: "image",
    mimeTypes: ["image/avif"],
    preview: "image",
  }),
  defineFormat({
    id: "svg",
    suffixes: ["svg"],
    cardType: "image",
    extension: "svg",
    kind: "image",
    language: "markup",
    mimeTypes: ["image/svg+xml", "application/xml", "text/xml"],
    preview: "image",
  }),
  defineFormat({
    id: "heic",
    suffixes: ["heic", "heif"],
    cardType: "image",
    extension: "heic",
    kind: "image",
    mimeTypes: ["image/heic", "image/heif", "image/heic-sequence"],
    preview: "image",
  }),
  defineFormat({
    id: "bitmap",
    suffixes: ["bmp", "tif", "tiff"],
    cardType: "image",
    extension: "image",
    kind: "image",
    mimeTypes: ["image/bmp", "image/tiff"],
    preview: "image",
  }),
  defineFormat({
    id: "mpeg-audio",
    suffixes: ["mp3"],
    cardType: "audio",
    extension: "mp3",
    kind: "audio",
    mimeTypes: ["audio/mpeg", "audio/mp3"],
    preview: "audio",
  }),
  defineFormat({
    id: "wave-audio",
    suffixes: ["wav"],
    cardType: "audio",
    extension: "wav",
    kind: "audio",
    mimeTypes: ["audio/wav", "audio/x-wav"],
    preview: "audio",
  }),
  defineFormat({
    id: "mp4-audio",
    suffixes: ["m4a"],
    cardType: "audio",
    extension: "m4a",
    kind: "audio",
    mimeTypes: ["audio/mp4", "audio/x-m4a"],
    preview: "audio",
  }),
  defineFormat({
    id: "aac-audio",
    suffixes: ["aac"],
    cardType: "audio",
    extension: "aac",
    kind: "audio",
    mimeTypes: ["audio/aac"],
    preview: "audio",
  }),
  defineFormat({
    id: "other-audio",
    suffixes: ["flac", "ogg", "oga", "opus"],
    cardType: "audio",
    extension: "audio",
    kind: "audio",
    mimeTypes: ["audio/flac", "audio/ogg", "audio/opus"],
    preview: "audio",
  }),
] as const satisfies readonly FileFormatDefinition[];

export type FileFormatId = (typeof FILE_FORMATS)[number]["id"];

export class FileFormatValidationError extends Error {
  readonly code:
    | "FILE_TOO_LARGE"
    | "INVALID_FILE_NAME"
    | "INVALID_MIME_TYPE"
    | "MIME_MISMATCH"
    | "UNSUPPORTED_FILE_TYPE";

  constructor(code: FileFormatValidationError["code"], message: string) {
    super(message);
    this.name = "FileFormatValidationError";
    this.code = code;
  }
}

export const normalizeMimeType = (
  mimeType: string | null | undefined
): string => mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";

export const validateFileName = (fileName: string): string => {
  const normalized = fileName.trim();
  if (
    !normalized ||
    normalized.length > MAX_FILE_NAME_LENGTH ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    hasControlCharacter(normalized)
  ) {
    throw new FileFormatValidationError(
      "INVALID_FILE_NAME",
      `fileName must be 1-${MAX_FILE_NAME_LENGTH} safe characters without path separators`
    );
  }
  return normalized;
};

const matchesFileName = (
  definition: FileFormatDefinition,
  lowerFileName: string
): boolean => {
  if (definition.fileNames?.includes(lowerFileName)) {
    return true;
  }
  return definition.suffixes.some(
    (suffix) => lowerFileName === suffix || lowerFileName.endsWith(`.${suffix}`)
  );
};

const findFormatByFileName = (
  fileName: string
): FileFormatDefinition | undefined => {
  const lowerFileName = fileName.toLowerCase();
  return FILE_FORMATS.find((definition) =>
    matchesFileName(definition, lowerFileName)
  );
};

const findFormatByMime = (mimeType: string): FileFormatDefinition | undefined =>
  FILE_FORMATS.find((definition) => definition.mimeTypes.includes(mimeType));

const publicFormat = (definition: FileFormatDefinition): FileFormat => ({
  cardType: definition.cardType,
  extension: definition.extension,
  id: definition.id,
  kind: definition.kind,
  language: definition.language,
  mimeType: definition.mimeType,
  mimeTypes: definition.mimeTypes,
  preview: definition.preview,
});

export const inferFileFormat = (input: {
  fileName: string;
  mimeType?: string | null;
}): FileFormat | null => {
  let fileName: string;
  try {
    fileName = validateFileName(input.fileName);
  } catch {
    return null;
  }

  const mimeType = normalizeMimeType(input.mimeType);
  const byFileName = findFormatByFileName(fileName);

  if (byFileName) {
    if (
      GENERIC_MIME_TYPES.has(mimeType) ||
      byFileName.mimeTypes.includes(mimeType)
    ) {
      return publicFormat(byFileName);
    }
    return null;
  }

  if (GENERIC_MIME_TYPES.has(mimeType)) {
    return null;
  }

  const byMime = findFormatByMime(mimeType);
  return byMime ? publicFormat(byMime) : null;
};

export const validateFileFormat = (input: {
  fileName: string;
  mimeType?: string | null;
}): FileFormat => {
  const fileName = validateFileName(input.fileName);
  const mimeType = normalizeMimeType(input.mimeType);

  if (mimeType && !MIME_TYPE_REGEX.test(mimeType)) {
    throw new FileFormatValidationError(
      "INVALID_MIME_TYPE",
      "mimeType must be a valid media type"
    );
  }

  const byFileName = findFormatByFileName(fileName);
  if (!byFileName) {
    const byMime =
      GENERIC_MIME_TYPES.has(mimeType) || !mimeType
        ? undefined
        : findFormatByMime(mimeType);
    if (byMime) {
      return publicFormat(byMime);
    }
    throw new FileFormatValidationError(
      "UNSUPPORTED_FILE_TYPE",
      "Unsupported file type"
    );
  }

  if (
    !(
      GENERIC_MIME_TYPES.has(mimeType) ||
      byFileName.mimeTypes.includes(mimeType)
    )
  ) {
    throw new FileFormatValidationError(
      "MIME_MISMATCH",
      "File extension does not match the provided MIME type"
    );
  }

  return publicFormat(byFileName);
};

export const validateUploadFile = (input: {
  fileName: string;
  fileSize: number;
  mimeType?: string | null;
}): { fileName: string; format: FileFormat; mimeType: string } => {
  if (!(Number.isFinite(input.fileSize) && input.fileSize > 0)) {
    throw new FileFormatValidationError(
      "FILE_TOO_LARGE",
      "fileSize must be a positive number"
    );
  }
  if (input.fileSize > MAX_FILE_SIZE) {
    throw new FileFormatValidationError(
      "FILE_TOO_LARGE",
      `fileSize must not exceed ${MAX_FILE_SIZE} bytes`
    );
  }

  const fileName = validateFileName(input.fileName);
  const format = validateFileFormat({
    fileName,
    mimeType: input.mimeType,
  });
  const normalizedMimeType = normalizeMimeType(input.mimeType);

  return {
    fileName,
    format,
    mimeType: GENERIC_MIME_TYPES.has(normalizedMimeType)
      ? format.mimeType
      : normalizedMimeType,
  };
};

export const mimeTypeForFileName = (fileName: string): string =>
  inferFileFormat({ fileName })?.mimeType ?? "application/octet-stream";
