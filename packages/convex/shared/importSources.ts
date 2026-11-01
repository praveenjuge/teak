import { FILES_IMPORT_MODES, type FilesImportMode } from "@teak/files-protocol";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const TEXT_MAX_BYTES = 20 * MIB;

export { FILES_IMPORT_MODES as IMPORT_MODES } from "@teak/files-protocol";
export type ImportMode = FilesImportMode;

export interface ImportSource {
  extensions: readonly string[];
  /**
   * Kept so jobs started with it still validate and show, but no longer
   * offered in the picker.
   */
  hidden?: true;
  hint: string;
  maxBytes: number;
  name: string;
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
    // "Text file of links" reads the same file (.agents/records/sunset.md).
    hidden: true,
  },
  csv: {
    title: "CSV file",
    name: "CSV",
    hint: "A CSV with a header row. Teak reads url, title, tags, folder, note and created columns.",
    extensions: [".csv"],
    maxBytes: 20 * MIB,
  },
  links: {
    title: "Text file of links",
    name: "text file",
    hint: 'One link per line, optionally followed by " | Title". OneTab\'s Export URLs works too.',
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
 * The sources the import picker offers, in its order: the general ones
 * first, then the named services, then Teak's own archive.
 */
export const IMPORT_PICKER_MODES: readonly ImportMode[] = (
  [
    "bookmarks",
    "csv",
    "links",
    "pocket",
    "raindrop",
    "instapaper",
    "readwise",
    "omnivore",
    "linkwarden",
    "mymind",
    "archive",
  ] as const satisfies readonly ImportMode[]
).filter((mode) => !IMPORT_SOURCES[mode].hidden);

export const IMPORT_FAILURE = {
  INVALID_SOURCE: "invalid_source",
  TOO_MANY_ITEMS: "too_many_items",
  MISSING_URL_COLUMN: "missing_url_column",
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
    if (mode === "links") {
      return "This file has no links. Put one link on each line.";
    }
    return mode === "archive"
      ? "This doesn't look like a Teak archive. Choose a ZIP from Export your data."
      : `This doesn't look like ${/^[aeiou]/i.test(source.name) ? "an" : "a"} ${source.name} export. Check the source and choose the file it describes.`;
  }
  if (failureClass === IMPORT_FAILURE.TOO_MANY_ITEMS) {
    return "This file has more than 10,000 items. Split it and import each part.";
  }
  if (failureClass === IMPORT_FAILURE.MISSING_URL_COLUMN) {
    return "This CSV has no url column. Add a header row with a url (or link) column.";
  }
  if (failureClass && /\s/.test(failureClass)) {
    return failureClass;
  }
  return "Import failed. Please try again.";
};

export const isImportMode = (value: unknown): value is ImportMode =>
  typeof value === "string" &&
  (FILES_IMPORT_MODES as readonly string[]).includes(value);

export const importFileMatches = (mode: ImportMode, fileName: string) => {
  const lower = fileName.trim().toLowerCase();
  return IMPORT_SOURCES[mode].extensions.some((extension) =>
    lower.endsWith(extension)
  );
};

export const importMaxBytes = (mode: ImportMode, fileName: string): number => {
  const { maxBytes } = IMPORT_SOURCES[mode];
  return fileName.trim().toLowerCase().endsWith(".zip")
    ? maxBytes
    : Math.min(maxBytes, TEXT_MAX_BYTES);
};

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
