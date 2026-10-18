import {
  THUMBNAIL_ERROR_MESSAGES,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_MIME_TYPES,
  toThumbnailMimeType,
} from "@teak/convex/shared/thumbnails";

export const LINK_THUMBNAIL_ACCEPT = THUMBNAIL_MIME_TYPES.join(",");

export const firstFile = (
  files: ArrayLike<File> | null | undefined
): File | undefined => (files && files.length > 0 ? files[0] : undefined);

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
