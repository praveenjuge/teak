/** Import source modes: Teak ZIP archive, Netscape bookmarks HTML, Raindrop CSV. */
export type ImportMode = "bookmarks" | "archive" | "raindrop";

/** Maximum cards created from a single import job. */
export const MAX_IMPORT_CARDS = 10_000;

/** Maximum bytes for one extracted import file. */
export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
