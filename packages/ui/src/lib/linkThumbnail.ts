import {
  THUMBNAIL_ERROR_MESSAGES,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_MIME_TYPES,
  toThumbnailMimeType,
} from "@teak/convex/shared/thumbnails";

/** The `accept` list for a link image file picker. */
export const LINK_THUMBNAIL_ACCEPT = THUMBNAIL_MIME_TYPES.join(",");

/** The first file of a drop or paste: one image replaces one image. */
export const firstFile = (
  files: ArrayLike<File> | null | undefined
): File | undefined => (files && files.length > 0 ? files[0] : undefined);

/** The first image a paste carries, if any. */
export const imageFromClipboard = (
  data: Pick<DataTransfer, "files" | "items"> | null
): File | undefined => {
  if (!data) {
    return;
  }
  const fromFiles = Array.from(data.files ?? []).find((file) =>
    file.type.startsWith("image/")
  );
  if (fromFiles) {
    return fromFiles;
  }
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile() ?? undefined;
    }
  }
};

/** Why a file can't be a link's image, before it is uploaded, or null. */
export const linkThumbnailFileProblem = (file: {
  size: number;
  type: string;
}): string | null => {
  if (!toThumbnailMimeType(file.type)) {
    return THUMBNAIL_ERROR_MESSAGES.unsupported;
  }
  if (file.size > THUMBNAIL_MAX_BYTES) {
    return THUMBNAIL_ERROR_MESSAGES.tooLarge;
  }
  return null;
};

/** The toast for a failed replace or reset; it names the problem, never the file. */
export const linkThumbnailErrorMessage = (error: unknown): string => {
  const data =
    error && typeof error === "object" && "data" in error
      ? (error as { data?: { code?: unknown; message?: unknown } }).data
      : undefined;
  switch (data?.code) {
    case "UNSUPPORTED_TYPE":
      return THUMBNAIL_ERROR_MESSAGES.unsupported;
    case "FILE_TOO_LARGE":
      return THUMBNAIL_ERROR_MESSAGES.tooLarge;
    case "INVALID_INPUT":
      return THUMBNAIL_ERROR_MESSAGES.unreadable;
    case "RATE_LIMITED":
      return THUMBNAIL_ERROR_MESSAGES.rateLimited;
    default:
      return typeof data?.message === "string"
        ? data.message
        : "Couldn't change the image. Try again.";
  }
};

/**
 * Whether a paste belongs to a field: text inputs, textareas and editable
 * regions such as the note editor keep their own paste.
 */
export const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target && typeof target === "object" && "tagName" in target)) {
    return false;
  }
  const element = target as HTMLElement;
  const tag = String(element.tagName).toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable === true ||
    Boolean(element.closest?.("[contenteditable='true'], [contenteditable='']"))
  );
};
