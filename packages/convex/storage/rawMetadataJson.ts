// Pure rules for archiving raw provider metadata, shared by Convex and the
// Files Worker so both decide alike which payloads leave the card.

export const RAW_METADATA_MAX_BYTES = 512 * 1024;
export const RAW_METADATA_KINDS = ["linkPreview", "linkCategory"] as const;
export type RawMetadataKind = (typeof RAW_METADATA_KINDS)[number];
const MIN_ARCHIVED_RAW_BYTES = 1024;

const survivesJsonRoundTrip = (value: unknown): boolean => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (Array.isArray(value)) {
    return value.every(survivesJsonRoundTrip);
  }
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every(survivesJsonRoundTrip)
  );
};

export const serializeRawMetadata = (raw: unknown): string | null => {
  if (!survivesJsonRoundTrip(raw)) {
    return null;
  }
  const json = JSON.stringify(raw);
  return new TextEncoder().encode(json).byteLength <= RAW_METADATA_MAX_BYTES
    ? json
    : null;
};

export const serializeArchivableRaw = (raw: unknown): string | null => {
  const json = serializeRawMetadata(raw);
  return json !== null &&
    new TextEncoder().encode(json).byteLength >= MIN_ARCHIVED_RAW_BYTES
    ? json
    : null;
};

/**
 * The fields an archived part keeps in place of its raw payload: categorization
 * still needs to know, without reading the archive, whether structured data
 * was stored and when it was fetched.
 */
export const archivedRawSummary = (
  kind: RawMetadataKind,
  raw: unknown
): { rawHasStructured?: boolean; rawStructuredFetchedAt?: number } => {
  if (kind !== "linkCategory") {
    return {};
  }
  const value = raw as {
    structured?: unknown;
    structuredMeta?: { fetchedAt?: unknown } | null;
  } | null;
  const fetchedAt = value?.structuredMeta?.fetchedAt;
  return {
    rawHasStructured: Boolean(value?.structured),
    rawStructuredFetchedAt:
      typeof fetchedAt === "number" ? fetchedAt : undefined,
  };
};
