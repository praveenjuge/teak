export type Platform = "x" | "instagram" | "pinterest" | "hackernews";

export interface ExtractedPost {
  permalink: string;
  platform: Platform;
  postKey: string;
}

type InlineSaveHostRule = {
  allowSubdomains: boolean;
  hosts: readonly string[];
  permalinkPolicy: "same-host" | "external-http";
};

export const INLINE_SAVE_PLATFORM_RULES: Record<Platform, InlineSaveHostRule> = {
  x: {
    hosts: ["x.com"],
    allowSubdomains: true,
    permalinkPolicy: "same-host",
  },
  instagram: {
    hosts: ["instagram.com"],
    allowSubdomains: true,
    permalinkPolicy: "same-host",
  },
  pinterest: {
    hosts: ["pinterest.com"],
    allowSubdomains: true,
    permalinkPolicy: "same-host",
  },
  hackernews: {
    hosts: ["news.ycombinator.com"],
    allowSubdomains: false,
    permalinkPolicy: "external-http",
  },
} as const;

const normalizeHost = (hostname: string): string =>
  hostname.trim().toLowerCase().replace(/\.$/u, "");

const matchesInlineSaveHostRule = (
  hostname: string,
  rule: InlineSaveHostRule
): boolean => {
  const normalized = normalizeHost(hostname);
  return rule.hosts.some(
    (host) =>
      normalized === host ||
      (rule.allowSubdomains && normalized.endsWith(`.${host}`))
  );
};

export const isPlatformInlineSaveHost = (
  platform: Platform,
  hostname: string
): boolean => matchesInlineSaveHostRule(hostname, INLINE_SAVE_PLATFORM_RULES[platform]);

export const isSupportedInlineSaveHost = (hostname: string): boolean =>
  Object.values(INLINE_SAVE_PLATFORM_RULES).some((rule) =>
    matchesInlineSaveHostRule(hostname, rule)
  );

const canParseHttpUrl = (value: string): URL | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const isInlineSavePermalinkAllowed = (
  platform: Platform,
  currentPageUrl: string,
  permalink: string
): boolean => {
  const pageUrl = canParseHttpUrl(currentPageUrl);
  const parsedPermalink = canParseHttpUrl(permalink);
  if (!(pageUrl && parsedPermalink)) {
    return false;
  }

  if (!isPlatformInlineSaveHost(platform, pageUrl.hostname)) {
    return false;
  }

  const policy = INLINE_SAVE_PLATFORM_RULES[platform].permalinkPolicy;
  if (policy === "external-http") {
    return !isPlatformInlineSaveHost(platform, parsedPermalink.hostname);
  }

  return normalizeHost(pageUrl.hostname) === normalizeHost(parsedPermalink.hostname);
};
