/**
 * Firefox's "Always use private browsing mode" runs Teak in a private session,
 * where an extension can't open IndexedDB. Sign-in and unsent saves then stay
 * in memory, and Firefox forgets them when it closes.
 */
export const isPrivateSession = () =>
  import.meta.env.BROWSER === "firefox" &&
  Boolean(chrome.extension?.inIncognitoContext);
