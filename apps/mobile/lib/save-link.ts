/**
 * Reads the text from a teak://save?text=… link, straight from the raw URL.
 *
 * expo-router rebuilds query strings from decoded values without encoding
 * them again, so a `#`, `&` or `%` inside the text cuts it short. Parsing the
 * URL the app was opened with keeps the text exactly as the shortcut sent it.
 */
export function textFromSaveLink(url: string | null): string {
  if (!url) {
    return "";
  }
  const queryStart = url.indexOf("?");
  if (queryStart === -1) {
    return "";
  }
  const hashStart = url.indexOf("#", queryStart);
  const query = url.slice(
    queryStart + 1,
    hashStart === -1 ? undefined : hashStart
  );
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    const key = separator === -1 ? pair : pair.slice(0, separator);
    if (key !== "text") {
      continue;
    }
    const value = separator === -1 ? "" : pair.slice(separator + 1);
    try {
      return decodeURIComponent(value.replaceAll("+", " ")).trim();
    } catch {
      return "";
    }
  }
  return "";
}
