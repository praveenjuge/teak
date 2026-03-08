export type Platform =
  | "x"
  | "instagram"
  | "pinterest"
  | "hackernews"
  | "sidebar"
  | "webdesignernews"
  | "heydesigner";

export type InlineSaveButtonVariant = "overlay" | "compact";
export type InlineSavePermalinkPolicy = "same-host" | "external-http";

export interface ExtractedPost {
  permalink: string;
  platform: Platform;
  postKey: string;
}

type InlineSaveHostRule = {
  allowSubdomains: boolean;
  buttonVariant: InlineSaveButtonVariant;
  hosts: readonly string[];
  permalinkPolicy: InlineSavePermalinkPolicy;
};

export const INLINE_SAVE_PLATFORM_RULES: Record<Platform, InlineSaveHostRule> =
  {
    x: {
      hosts: ["x.com"],
      allowSubdomains: true,
      buttonVariant: "overlay",
      permalinkPolicy: "same-host",
    },
    instagram: {
      hosts: ["instagram.com"],
      allowSubdomains: true,
      buttonVariant: "overlay",
      permalinkPolicy: "same-host",
    },
    pinterest: {
      hosts: ["pinterest.com"],
      allowSubdomains: true,
      buttonVariant: "overlay",
      permalinkPolicy: "same-host",
    },
    hackernews: {
      hosts: ["news.ycombinator.com"],
      allowSubdomains: false,
      buttonVariant: "compact",
      permalinkPolicy: "external-http",
    },
    sidebar: {
      hosts: ["sidebar.io"],
      allowSubdomains: true,
      buttonVariant: "compact",
      permalinkPolicy: "external-http",
    },
    webdesignernews: {
      hosts: ["webdesignernews.com"],
      allowSubdomains: true,
      buttonVariant: "compact",
      permalinkPolicy: "external-http",
    },
    heydesigner: {
      hosts: ["heydesigner.com"],
      allowSubdomains: true,
      buttonVariant: "compact",
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
): boolean =>
  matchesInlineSaveHostRule(hostname, INLINE_SAVE_PLATFORM_RULES[platform]);

export const getInlineSavePlatformRule = (
  platform: Platform
): InlineSaveHostRule => INLINE_SAVE_PLATFORM_RULES[platform];

export const getInlineSaveButtonVariant = (
  platform: Platform
): InlineSaveButtonVariant => getInlineSavePlatformRule(platform).buttonVariant;

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

  return (
    normalizeHost(pageUrl.hostname) === normalizeHost(parsedPermalink.hostname)
  );
};
