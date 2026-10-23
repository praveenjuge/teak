const TRACKING_PARAMETERS = new Set(["fbclid", "gclid"]);

const isTrackingParameter = (part: string): boolean => {
  const rawName = part.split("=", 1)[0] ?? "";
  let name = rawName;
  try {
    name = decodeURIComponent(rawName.replaceAll("+", " "));
  } catch {
    // A malformed escape stays as written.
  }
  const lower = name.toLowerCase();
  return TRACKING_PARAMETERS.has(lower) || lower.startsWith("utm_");
};

/**
 * The key two saved links share when they are the same page: the scheme, a
 * leading `www.`, a default port, one trailing slash, a fragment and the
 * `utm_*`, `fbclid` and `gclid` parameters don't count. `#/` and `#!` hash
 * routes, every other parameter in its order, the path's case and any
 * userinfo do. Anything but an http(s) URL has no key.
 */
export const urlKey = (url: string): string | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return;
  }

  let host = parsed.hostname.toLowerCase();
  while (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  if (host.startsWith("www.") && host.length > 4) {
    host = host.slice(4);
  }
  if (!host) {
    return;
  }
  const port =
    parsed.port && parsed.port !== "80" && parsed.port !== "443"
      ? `:${parsed.port}`
      : "";
  const userinfo =
    parsed.username || parsed.password
      ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@`
      : "";

  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  const query = parsed.search
    .slice(1)
    .split("&")
    .filter((part) => part && !isTrackingParameter(part))
    .join("&");
  const hash = parsed.hash;
  const fragment = hash.startsWith("#/") || hash.startsWith("#!") ? hash : "";

  return `${userinfo}${host}${port}${path}${query ? `?${query}` : ""}${fragment}`;
};
