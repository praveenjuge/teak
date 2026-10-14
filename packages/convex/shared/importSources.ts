// The files Teak imports, shared by the upload check, the Files Worker and
// the web import panel so they agree on names, extensions and size limits.

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
/** Files read whole into memory (everything but a ZIP) stop here. */
const TEXT_MAX_BYTES = 20 * MIB;

export const IMPORT_MODES = [
  "bookmarks",
  "pocket",
  "raindrop",
  "instapaper",
  "readwise",
  "omnivore",
  "linkwarden",
  "mymind",
  "onetab",
  "archive",
] as const;

export type ImportMode = (typeof IMPORT_MODES)[number];

export interface ImportSource {
  /** File extensions the picker accepts, lowercase with the dot. */
  extensions: readonly string[];
  /** Which file to upload, in one line. */
  hint: string;
  /** Largest upload, in bytes; see importMaxBytes for a given file. */
  maxBytes: number;
  /** The source's name, as in "This doesn't look like a {name} export". */
  name: string;
  /** The picker's label for the source. */
  title: string;
}

export const IMPORT_SOURCES: Record<ImportMode, ImportSource> = {
  bookmarks: {
    title: "Browser bookmarks",
    name: "browser bookmarks",
    hint: "The bookmarks HTML file from your browser's Export bookmarks.",
    extensions: [".html", ".htm"],
    maxBytes: 20 * MIB,
  },
  pocket: {
    title: "Pocket",
    name: "Pocket",
    hint: "The CSV from Pocket's export, or its older HTML export.",
    extensions: [".csv", ".html", ".htm"],
    maxBytes: 20 * MIB,
  },
  raindrop: {
    title: "Raindrop.io",
    name: "Raindrop",
    hint: "The CSV from Raindrop's Settings → Backups → Export.",
    extensions: [".csv"],
    maxBytes: 20 * MIB,
  },
  instapaper: {
    title: "Instapaper",
    name: "Instapaper",
    hint: "The CSV from Instapaper's Settings → Export.",
    extensions: [".csv"],
    maxBytes: 20 * MIB,
  },
  readwise: {
    title: "Readwise Reader",
    name: "Readwise Reader",
    hint: "The CSV from Reader's Export library as CSV.",
    extensions: [".csv"],
    maxBytes: 20 * MIB,
  },
  omnivore: {
    title: "Omnivore",
    name: "Omnivore",
    hint: "The ZIP from Omnivore's export, as you downloaded it.",
    extensions: [".zip", ".json"],
    maxBytes: 5 * GIB,
  },
  linkwarden: {
    title: "Linkwarden",
    name: "Linkwarden",
    hint: "The JSON backup from Linkwarden's Settings → Data → Export.",
    extensions: [".json"],
    maxBytes: 20 * MIB,
  },
  mymind: {
    title: "mymind",
    name: "mymind",
    hint: "The CSV from mymind's Settings → Export.",
    extensions: [".csv"],
    maxBytes: 20 * MIB,
  },
  onetab: {
    title: "OneTab",
    name: "OneTab",
    hint: "OneTab's Export URLs text, saved as a .txt file.",
    extensions: [".txt"],
    maxBytes: 20 * MIB,
  },
  archive: {
    title: "Teak archive",
    name: "Teak",
    hint: "A ZIP from Export your data in Teak.",
    extensions: [".zip"],
    maxBytes: 5 * GIB,
  },
};

/**
 * Failure classes an import job can end with that describeImportFailure
 * words for people.
 */
export const IMPORT_FAILURE = {
  INVALID_SOURCE: "invalid_source",
  TOO_MANY_ITEMS: "too_many_items",
} as const;

/**
 * What to tell someone whose import failed. Failure classes that are codes
 * (no spaces) get a sentence; ones already written for people pass through.
 */
export const describeImportFailure = (
  mode: ImportMode,
  failureClass: string | undefined
): string => {
  const source = IMPORT_SOURCES[mode];
  if (failureClass === IMPORT_FAILURE.INVALID_SOURCE) {
    return mode === "archive"
      ? "This doesn't look like a Teak archive. Choose a ZIP from Export your data."
      : `This doesn't look like ${/^[aeiou]/i.test(source.name) ? "an" : "a"} ${source.name} export. Check the source and choose the file it describes.`;
  }
  if (failureClass === IMPORT_FAILURE.TOO_MANY_ITEMS) {
    return "This file has more than 10,000 items. Split it and import each part.";
  }
  if (failureClass && /\s/.test(failureClass)) {
    return failureClass;
  }
  return "Import failed. Please try again.";
};

export const isImportMode = (value: unknown): value is ImportMode =>
  typeof value === "string" &&
  (IMPORT_MODES as readonly string[]).includes(value);

/** Whether `fileName` has one of the source's extensions. */
export const importFileMatches = (mode: ImportMode, fileName: string) => {
  const lower = fileName.trim().toLowerCase();
  return IMPORT_SOURCES[mode].extensions.some((extension) =>
    lower.endsWith(extension)
  );
};

/**
 * The largest upload for this file: the source's limit for a ZIP, and at
 * most 20 MiB for anything else, which is read whole (an Omnivore .json).
 */
export const importMaxBytes = (mode: ImportMode, fileName: string): number => {
  const { maxBytes } = IMPORT_SOURCES[mode];
  return fileName.trim().toLowerCase().endsWith(".zip")
    ? maxBytes
    : Math.min(maxBytes, TEXT_MAX_BYTES);
};

/** The upload's content type, from its extension. */
export const importContentType = (fileName: string): string => {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith(".zip")) {
    return "application/zip";
  }
  if (lower.endsWith(".csv")) {
    return "text/csv";
  }
  if (lower.endsWith(".json")) {
    return "application/json";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain";
  }
  return "text/html";
};
