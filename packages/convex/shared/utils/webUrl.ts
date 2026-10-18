const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const parseWebUrl = (value: string): URL | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === "https:" ||
    (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
    ? url
    : null;
};

export const fetchWebUrl = (
  url: string,
  init: RequestInit | undefined,
  notWebUrl: () => Error
): Promise<Response> => {
  const target = parseWebUrl(url);
  if (!target) {
    return Promise.reject(notWebUrl());
  }
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  return fetch(target, init);
};
