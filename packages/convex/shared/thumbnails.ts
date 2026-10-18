/** The Images binding's input cap in the Files Worker's finalize op. */
export const THUMBNAIL_MAX_BYTES = 20 * 1024 * 1024;

export const THUMBNAIL_UNDO_WINDOW_MS = 2 * 60 * 1000;

export const THUMBNAIL_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export type ThumbnailMimeType = (typeof THUMBNAIL_MIME_TYPES)[number];

export const THUMBNAIL_ERROR_MESSAGES = {
  rateLimited: "You've changed a lot of images. Try again in a minute.",
  tooLarge: "Images must be under 20 MB.",
  unreadable: "This image couldn't be read.",
  unsupported: "Use a JPEG, PNG, WebP, GIF or AVIF image.",
} as const;

const MIME_ALIASES: Record<string, ThumbnailMimeType> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};

export const toThumbnailMimeType = (
  value: string | null | undefined
): ThumbnailMimeType | null => {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const mime = MIME_ALIASES[normalized] ?? normalized;
  return (THUMBNAIL_MIME_TYPES as readonly string[]).includes(mime)
    ? (mime as ThumbnailMimeType)
    : null;
};
