/**
 * The media type rules both sides of the contract read: how a type is
 * normalised, and which types say only "some bytes". The file format
 * registry (`FILE_FORMATS` in `@teak/convex/shared/fileFormats`) builds on
 * these; the Core Worker's link fetcher, which bundles only this package,
 * reads them here.
 */

/** A media type without parameters, trimmed and lowercase. */
export const normalizeMediaType = (
  mediaType: string | null | undefined
): string => mediaType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";

/** Types (and no type at all) that say nothing about the bytes. */
export const GENERIC_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "",
  "application/binary",
  "application/octet-stream",
  "binary/octet-stream",
]);

export const isGenericMediaType = (
  mediaType: string | null | undefined
): boolean => GENERIC_MEDIA_TYPES.has(normalizeMediaType(mediaType));
