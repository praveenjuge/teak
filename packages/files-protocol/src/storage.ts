export const FILES_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

export const FILES_SIGNED_URL_MIN_VALIDITY_SECONDS = 7 * 24 * 60 * 60;

const FILE_CACHE_MAX_AGE_SECONDS =
  FILES_SIGNED_URL_MIN_VALIDITY_SECONDS - 24 * 60 * 60;

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

/**
 * Key prefix of the development deployment's objects. The Worker serves only
 * the production (`""`) and development prefixes.
 */
export const FILES_DEV_KEY_PREFIX = "dev/";
export const FILES_KEY_PREFIXES = ["", FILES_DEV_KEY_PREFIX] as const;
export type FilesKeyPrefix = (typeof FILES_KEY_PREFIXES)[number];

/**
 * Reads a deployment's `R2_KEY_PREFIX`. Surrounding spaces and slashes are
 * forgiven; a prefix the Worker would refuse throws.
 */
export const parseFilesKeyPrefix = (
  raw: string | undefined
): FilesKeyPrefix => {
  const trimmed = (raw ?? "").trim().replace(/^\/+/u, "");
  const normalized =
    trimmed && !trimmed.endsWith("/") ? `${trimmed}/` : trimmed;
  const prefix = FILES_KEY_PREFIXES.find((known) => known === normalized);
  if (prefix === undefined) {
    throw new Error("invalid_r2_key_prefix");
  }
  return prefix;
};

export const filesUserKeyRoot = (envPrefix: string): string =>
  `${envPrefix}users/`;

export const filesExportKeyRoot = (envPrefix: string): string =>
  `${envPrefix}exports/`;

export const FILES_USER_KEY_ROOTS = FILES_KEY_PREFIXES.map(filesUserKeyRoot);

export const FILES_OBJECT_KEY_ROOTS = FILES_KEY_PREFIXES.flatMap(
  (envPrefix) => [filesUserKeyRoot(envPrefix), filesExportKeyRoot(envPrefix)]
);

const MAX_OBJECT_KEY_LENGTH = 1024;

/** A key under a known root with no empty, `..` or NUL segments. */
export const isValidObjectKey = (key: string): boolean =>
  key.length > 0 &&
  key.length <= MAX_OBJECT_KEY_LENGTH &&
  FILES_OBJECT_KEY_ROOTS.some((root) => key.startsWith(root)) &&
  !key.includes("\0") &&
  !key.includes("//") &&
  !key.split("/").includes("..");

const userSegmentOf = (key: string): string | null => {
  const root = FILES_USER_KEY_ROOTS.find((candidate) =>
    key.startsWith(candidate)
  );
  return root === undefined
    ? null
    : key.slice(root.length).split("/")[0] || null;
};

/** Both keys sit under the same user's folder, whatever their prefix. */
export const isSameUserNamespace = (left: string, right: string): boolean => {
  const user = userSegmentOf(left);
  return user !== null && user === userSegmentOf(right);
};

const hashUserId = (userId: string): string =>
  Array.from(new TextEncoder().encode(userId))
    .reduce((hash, byte) => (hash * 31 + byte) % 2 ** 32, 0)
    .toString(36);

export const filesCardKeyPrefix = (envPrefix: string, userId: string): string =>
  `${filesUserKeyRoot(envPrefix)}${hashUserId(userId)}/cards`;

/**
 * The card segment of an object uploaded before its card exists. The
 * Worker's stale-upload cleanup deletes what stays here past a day.
 */
export const FILES_PENDING_CARD_SEGMENT = "upload-pending-v2";
/** How long an upload may wait for its card before the Worker deletes it. */
export const FILES_PENDING_UPLOAD_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The card segment of an object that belongs to no card, such as an import's
 * source archive. Nothing deletes it by age: its owner (the import job) does.
 */
export const FILES_NO_CARD_SEGMENT = "pending";

/** A user's object still waiting under the pending card segment. */
export const isPendingUploadKey = (key: string): boolean =>
  FILES_USER_KEY_ROOTS.some((root) => key.startsWith(root)) &&
  key.includes(`/cards/${FILES_PENDING_CARD_SEGMENT}/`) &&
  !key.split("/").includes("..");

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
    cardId ?? FILES_NO_CARD_SEGMENT,
    role,
    `${id}${safeName ? `-${safeName}` : ""}`,
  ].join("/");
};

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
    ...(cardId &&
    cardId !== FILES_PENDING_CARD_SEGMENT &&
    cardId !== FILES_NO_CARD_SEGMENT
      ? { cardId }
      : {}),
    ...(role ? { role } : {}),
  };
};

export const FILES_EXPORT_MANIFEST_VERSION = 1 as const;

export interface FilesExportManifestEntry {
  contentBase64?: string;
  path: string;
  storageKey?: string;
}

export interface FilesExportManifest {
  entries: FilesExportManifestEntry[];
  maxBytes: number;
  v: typeof FILES_EXPORT_MANIFEST_VERSION;
}
