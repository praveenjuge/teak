import { FOCUS_COMPOSER_PARAM } from "@/lib/libraryViews";

/**
 * What the installed web app receives from the system share sheet. The service
 * worker (`/sw.js`) turns the share into a library URL; the `/share` route
 * does the same when no worker answered. The library then fills the composer
 * from the text fields and queues any files.
 */

/** The text fields a share carries, as the manifest's `share_target` names them. */
export const SHARE_TEXT_FIELDS = ["title", "text", "url"] as const;
export type ShareTextField = (typeof SHARE_TEXT_FIELDS)[number];
export type SharedText = Partial<Record<ShareTextField, string>>;

/** The library URL's parameter holding the id of files kept for the library. */
export const SHARE_FILES_PARAM = "share";
/** The id when files were shared but couldn't be kept. */
export const SHARE_FILES_MISSING = "missing";
/** The Cache Storage cache the service worker keeps shared files in. */
export const SHARE_CACHE = "teak-share";
/** Each kept file sits at `${SHARE_FILE_PREFIX}<id>/<index>` in that cache. */
export const SHARE_FILE_PREFIX = "/__share/";
/** Kept files older than this are deleted. */
export const SHARE_FILES_MAX_AGE_MS = 60 * 60 * 1000;
/** The response header holding a kept file's name. */
export const SHARE_FILE_NAME_HEADER = "x-teak-file-name";
/**
 * How long each text field may be once percent-encoded. The fields ride in
 * the URL, and through sign-in they're encoded a second time, so a long
 * selection is cut to keep the URL well under servers' 8 KB limit. The text
 * gets what the link and title leave of the total.
 */
export const SHARE_ENCODED_BUDGET = {
  total: 3000,
  url: 1500,
  title: 300,
} as const;

const LONE_URL = /^https?:\/\/\S+$/i;

const clean = (value: string | null | undefined) => (value ?? "").trim();

const encodedLength = (char: string) => {
  try {
    return encodeURIComponent(char).length;
  } catch {
    return 9; // A lone surrogate, which the URL writes as U+FFFD.
  }
};

/** The longest start of `value` whose encoding fits `budget`, and its encoded length. */
const cutToEncoded = (value: string, budget: number): [string, number] => {
  let used = 0;
  let end = 0;
  for (const char of value) {
    const size = encodedLength(char);
    if (used + size > budget) {
      break;
    }
    used += size;
    end += char.length;
  }
  return [value.slice(0, end), used];
};

/** The share's text fields, trimmed and cut to fit in the library URL. */
export const fitSharedText = (shared: SharedText): SharedText => {
  const [url, urlSize] = cutToEncoded(
    clean(shared.url),
    SHARE_ENCODED_BUDGET.url
  );
  const [title, titleSize] = cutToEncoded(
    clean(shared.title),
    SHARE_ENCODED_BUDGET.title
  );
  const [text] = cutToEncoded(
    clean(shared.text),
    SHARE_ENCODED_BUDGET.total - urlSize - titleSize
  );
  return { title, text, url };
};

/** The library URL a share opens: the composer, its text, and any kept files. */
export const shareLibraryPath = (
  shared: SharedText,
  filesId?: string
): string => {
  const params = new URLSearchParams({ [FOCUS_COMPOSER_PARAM]: "1" });
  const fitted = fitSharedText(shared);
  for (const field of SHARE_TEXT_FIELDS) {
    const value = fitted[field];
    if (value) {
      params.set(field, value);
    }
  }
  if (filesId) {
    params.set(SHARE_FILES_PARAM, filesId);
  }
  return `/?${params.toString()}`;
};

/**
 * The composer's text for a share. A shared link is the link alone; text
 * keeps the page's title above it and the link below, never twice.
 */
export const sharedDraft = (shared: SharedText): string => {
  const title = clean(shared.title);
  const text = clean(shared.text);
  const url = clean(shared.url);
  if (!url && LONE_URL.test(text)) {
    return text;
  }
  if (url && (!text || text === url)) {
    return url;
  }
  const lines: string[] = [];
  if (title && !text.includes(title)) {
    lines.push(title);
  }
  if (text) {
    lines.push(text);
  }
  if (url && !text.includes(url)) {
    lines.push(url);
  }
  return lines.join("\n");
};

/** Reads a share's text fields from the library URL. */
export const readSharedText = (params: {
  get: (name: string) => string | null;
}): SharedText | null => {
  const shared: SharedText = {};
  for (const field of SHARE_TEXT_FIELDS) {
    const value = params.get(field);
    if (value) {
      shared[field] = value;
    }
  }
  return Object.keys(shared).length > 0 ? shared : null;
};

/**
 * The URL's query without a share's text, once the composer took it. The
 * files' id stays: `useSharedFiles` removes it once the files are saved or
 * turned down, so a reload while it asks finds them again.
 */
export const withoutShareParams = (search: string): string => {
  const params = new URLSearchParams(search);
  for (const field of SHARE_TEXT_FIELDS) {
    params.delete(field);
  }
  return params.toString();
};

/** The URL's query without the shared files' id. */
export const withoutSharedFilesParam = (search: string): string => {
  const params = new URLSearchParams(search);
  params.delete(SHARE_FILES_PARAM);
  return params.toString();
};
