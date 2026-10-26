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
 * Characters kept from each text field. The fields ride in the URL, through
 * sign-in too, so a very long selection is cut rather than overflowing it.
 */
export const SHARE_TEXT_LIMIT = 6000;

const LONE_URL = /^https?:\/\/\S+$/i;

const clean = (value: string | null | undefined) => (value ?? "").trim();

/** The library URL a share opens: the composer, its text, and any kept files. */
export const shareLibraryPath = (
  shared: SharedText,
  filesId?: string
): string => {
  const params = new URLSearchParams({ [FOCUS_COMPOSER_PARAM]: "1" });
  for (const field of SHARE_TEXT_FIELDS) {
    const value = clean(shared[field]);
    if (value) {
      params.set(field, value.slice(0, SHARE_TEXT_LIMIT));
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

/** The URL's query without a share's parameters, once the library took them. */
export const withoutShareParams = (search: string): string => {
  const params = new URLSearchParams(search);
  for (const field of SHARE_TEXT_FIELDS) {
    params.delete(field);
  }
  params.delete(SHARE_FILES_PARAM);
  return params.toString();
};
