// Pages where the extension cannot inject scripts, so it cannot save them.
const RESTRICTED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "chrome-search://",
  "chrome-untrusted://",
  "devtools://",
  "edge://",
  "brave://",
  "opera://",
  "vivaldi://",
  "moz-extension://",
  "edge-extension://",
  "about:",
  "data:",
  "file://",
  "view-source:",
  "filesystem:",
];

// Browsers block extensions on their own add-on stores, even over https.
const EXTENSION_STORES: { host: string; path?: string }[] = [
  { host: "chromewebstore.google.com" },
  { host: "chrome.google.com", path: "/webstore" },
  { host: "microsoftedge.microsoft.com", path: "/addons" },
  { host: "addons.mozilla.org" },
];

const parseUrl = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

const isExtensionStoreUrl = (url: string): boolean => {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return EXTENSION_STORES.some(
    (store) =>
      host === store.host &&
      (!store.path ||
        parsed.pathname === store.path ||
        parsed.pathname.startsWith(`${store.path}/`))
  );
};

export function isRestrictedUrl(url?: string): boolean {
  if (!url) {
    return true;
  }
  const lower = url.toLowerCase();
  return (
    RESTRICTED_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
    isExtensionStoreUrl(url)
  );
}

const TRY_ELSEWHERE = "Try using the extension on regular web pages.";

/** The message shown when a save starts on a page the extension can't read. */
export function restrictedUrlMessage(url?: string): string {
  if (url && isExtensionStoreUrl(url)) {
    return `Browsers don't let extensions save from add-on store pages. ${TRY_ELSEWHERE}`;
  }
  const protocol = url ? parseUrl(url)?.protocol : undefined;
  return protocol
    ? `Cannot save content from ${protocol} pages. ${TRY_ELSEWHERE}`
    : `Cannot save content from this page. ${TRY_ELSEWHERE}`;
}
