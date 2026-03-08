const TRACKING_SEARCH_PARAMS = [
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
] as const;

const parseHttpUrl = (value: string, baseUrl?: string): URL | null => {
  try {
    const parsed = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const canonicalizeOutboundUrl = (
  value: string,
  options: {
    baseUrl?: string;
    extraSearchParamsToStrip?: readonly string[];
    redirectParam?: string;
  } = {}
): string | null => {
  let parsed = parseHttpUrl(value, options.baseUrl);
  if (!parsed) {
    return null;
  }

  if (options.redirectParam) {
    const redirectTarget = parsed.searchParams.get(options.redirectParam);
    if (!redirectTarget) {
      return null;
    }

    parsed = parseHttpUrl(redirectTarget);
    if (!parsed) {
      return null;
    }
  }

  parsed.hash = "";

  for (const searchParam of TRACKING_SEARCH_PARAMS) {
    parsed.searchParams.delete(searchParam);
  }

  for (const searchParam of options.extraSearchParamsToStrip ?? []) {
    parsed.searchParams.delete(searchParam);
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
  parsed.search = parsed.searchParams.toString();

  return parsed.toString();
};
