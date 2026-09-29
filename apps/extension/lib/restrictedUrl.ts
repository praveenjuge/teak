// Pages where the extension cannot inject scripts, so it cannot save them.
export function isRestrictedUrl(url?: string): boolean {
  if (!url) {
    return true;
  }

  const restrictedPrefixes = [
    "chrome://",
    "chrome-extension://",
    "moz-extension://",
    "edge-extension://",
    "about:",
    "data:",
    "file://",
    "view-source:",
    "filesystem:",
  ];

  return restrictedPrefixes.some((prefix) => url.startsWith(prefix));
}
