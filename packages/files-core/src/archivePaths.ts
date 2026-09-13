/**
 * Validation for archive entry paths (ZIP central-directory names and
 * caller-supplied extraction targets).
 *
 * Rejects absolute paths, Windows separators, NUL bytes, and any `..` or
 * empty segment so extraction can never escape the destination namespace.
 * A trailing slash (directory entry) is tolerated.
 */
export function isSafeArchivePath(path: string): boolean {
  if (
    !path ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.includes("\0")
  ) {
    return false;
  }
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  const segments = normalized.split("/");
  return !segments.some((segment) => segment === ".." || segment === "");
}
