/**
 * R2 object keys, signed file URLs and export manifests: minted by Convex,
 * validated and served by the Files Worker.
 */

/** Largest object an upload may store; the media renderer reads any of them. */
export const FILES_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

/** Shortest remaining validity of a signed file URL when Convex mints it. */
export const FILES_SIGNED_URL_MIN_VALIDITY_SECONDS = 7 * 24 * 60 * 60;

/** A day short of the signed-URL validity, so browsers never replay an expired signature. */
const FILE_CACHE_MAX_AGE_SECONDS =
  FILES_SIGNED_URL_MIN_VALIDITY_SECONDS - 24 * 60 * 60;

/** Cache-Control of a signed file response sent to the browser. */
export const FILES_PRIVATE_CACHE_CONTROL = `private, max-age=${FILE_CACHE_MAX_AGE_SECONDS}, immutable`;

/**
 * Cache-Control of the copy kept in the Workers edge cache, which refuses to
 * store `private` responses. Entries are keyed by the user-scoped object path.
 */
export const FILES_EDGE_CACHE_CONTROL = `public, max-age=${FILE_CACHE_MAX_AGE_SECONDS}, immutable`;

/**
 * Signing payload of a signed file URL. An empty content type or disposition
 * leaves the Worker serving the object's stored metadata.
 */
export const buildFileSigningPayload = ({
  key,
  exp,
  contentType = "",
  contentDisposition = "",
}: {
  contentDisposition?: string | null;
  contentType?: string | null;
  exp: string;
  key: string;
}): string => [key, exp, contentType, contentDisposition].join("\n");

/** Key prefix of the development deployment, which shares the production bucket. */
export const FILES_DEV_KEY_PREFIX = "dev/";

/** Root of every card object key under an environment prefix. */
export const filesUserKeyRoot = (envPrefix: string): string =>
  `${envPrefix}users/`;

/** Root of export archives, which an R2 lifecycle rule expires. */
export const filesExportKeyRoot = (envPrefix: string): string =>
  `${envPrefix}exports/`;

/** Every root the Worker accepts an object key under. */
export const FILES_OBJECT_KEY_ROOTS = ["", FILES_DEV_KEY_PREFIX].flatMap(
  (envPrefix) => [filesUserKeyRoot(envPrefix), filesExportKeyRoot(envPrefix)]
);

const hashUserId = (userId: string): string =>
  Array.from(new TextEncoder().encode(userId))
    .reduce((hash, byte) => (hash * 31 + byte) % 2 ** 32, 0)
    .toString(36);

export const filesCardKeyPrefix = (envPrefix: string, userId: string): string =>
  `${filesUserKeyRoot(envPrefix)}${hashUserId(userId)}/cards`;

const PENDING_CARD_SEGMENT = "pending";

/** `<env prefix>users/<user hash>/cards/<card id | pending>/<role>/<uuid>[-<name>]` */
export const buildCardObjectKey = ({
  envPrefix,
  userId,
  cardId,
  role,
  fileName,
  objectId,
}: {
  cardId?: string;
  envPrefix: string;
  fileName?: string;
  /** A fixed id, so a retried write lands on the same key; random otherwise. */
  objectId?: string;
  role: string;
  userId: string;
}): string => {
  const safeName = fileName?.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  const id = objectId?.replace(/[^a-zA-Z0-9_-]+/g, "-") || crypto.randomUUID();
  return [
    filesCardKeyPrefix(envPrefix, userId),
    cardId ?? PENDING_CARD_SEGMENT,
    role,
    `${id}${safeName ? `-${safeName}` : ""}`,
  ].join("/");
};

/** The card and role a card object key names; empty for any other key. */
export const parseCardObjectKey = (
  key: string
): { cardId?: string; role?: string } => {
  const segments = (
    key.startsWith(FILES_DEV_KEY_PREFIX)
      ? key.slice(FILES_DEV_KEY_PREFIX.length)
      : key
  ).split("/");
  if (
    segments.length < 5 ||
    segments[0] !== "users" ||
    segments[2] !== "cards"
  ) {
    return {};
  }
  const [cardId, role] = [segments[3], segments[4]];
  return {
    ...(cardId && cardId !== PENDING_CARD_SEGMENT ? { cardId } : {}),
    ...(role ? { role } : {}),
  };
};

export const FILES_EXPORT_MANIFEST_VERSION = 1 as const;

/**
 * An archive entry: inline content, or an object the Worker streams in. An
 * object that cannot be read after one retry is left out and reported by path.
 */
export interface FilesExportManifestEntry {
  contentBase64?: string;
  path: string;
  storageKey?: string;
}

/** The build-export op's manifest, which Convex stores in R2 beside the archive. */
export interface FilesExportManifest {
  entries: FilesExportManifestEntry[];
  maxBytes: number;
  v: typeof FILES_EXPORT_MANIFEST_VERSION;
}
