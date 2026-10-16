/**
 * Rules for the image someone chooses for a link card in place of its scraped
 * one. Shared by the backend (card/thumbnailOverride.ts), the public API and
 * the web, so every surface accepts and refuses the same files.
 */

/** The Images binding's input cap in the Files Worker's finalize op. */
export const THUMBNAIL_MAX_BYTES = 20 * 1024 * 1024;

/** How long a replace or reset can be undone; its old image is kept until then. */
export const THUMBNAIL_UNDO_WINDOW_MS = 2 * 60 * 1000;

/**
 * Raster formats the worker decodes and browsers show. SVG is refused, and
 * HEIC too: its decode through finalize-image-upload is unproven.
 */
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

/** The accepted MIME type a header or file type names, or null. */
export const toThumbnailMimeType = (
  value: string | null | undefined
): ThumbnailMimeType | null => {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const mime = MIME_ALIASES[normalized] ?? normalized;
  return (THUMBNAIL_MIME_TYPES as readonly string[]).includes(mime)
    ? (mime as ThumbnailMimeType)
    : null;
};
