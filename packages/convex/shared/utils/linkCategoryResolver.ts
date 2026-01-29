import { LINK_CATEGORIES, type LinkCategory } from "../linkCategories";

export type LinkCategoryResolutionReason =
  | "domain_rule"
  | "path_rule"
  | "provider_mapping"
  | "heuristic"
  | "fallback";

export interface LinkCategoryResolution {
  category: LinkCategory;
  confidence: number;
  provider?: string;
  reason: LinkCategoryResolutionReason;
  rule?: string;
}

type DomainRule = {
  domain: string;
  category: LinkCategory;
  provider?: string;
  pathIncludes?: RegExp[];
  confidence?: number;
  description?: string;
};

type PathRule = {
  test: RegExp;
  category: LinkCategory;
  confidence?: number;
  description?: string;
};

const DEFAULT_DOMAIN_CONFIDENCE = 0.98;
const DEFAULT_PATH_CONFIDENCE = 0.8;
const PROVIDER_CONFIDENCE = 0.72;
const HEURISTIC_CONFIDENCE = 0.58;
const FALLBACK_CONFIDENCE = 0.35;

const DOMAIN_RULES: DomainRule[] = [
  { domain: "github.com", category: "software", provider: "github" },
  { domain: "gitlab.com", category: "software" },
  { domain: "bitbucket.org", category: "software" },
  { domain: "npmjs.com", category: "software" },
  { domain: "pypi.org", category: "software" },
  { domain: "rubygems.org", category: "software" },
  { domain: "imdb.com", category: "movie", provider: "imdb" },
  { domain: "letterboxd.com", category: "movie" },
  { domain: "goodreads.com", category: "book", provider: "goodreads" },
  { domain: "audible.com", category: "book" },
  { domain: "amazon.com", category: "product", provider: "amazon" },
  { domain: "amazon.co.uk", category: "product", provider: "amazon" },
  { domain: "amazon.in", category: "product", provider: "amazon" },
  { domain: "dribbble.com", category: "design_portfolio", provider: "dribbble" },
  { domain: "behance.net", category: "design_portfolio" },
  { domain: "figma.com", category: "design_portfolio", provider: "figma" },
  { domain: "youtube.com", category: "tv", provider: "youtube" },
  { domain: "youtu.be", category: "tv", provider: "youtube" },
  { domain: "vimeo.com", category: "tv" },
  { domain: "medium.com", category: "article", provider: "medium" },
  { domain: "substack.com", category: "article", provider: "substack" },
  { domain: "dev.to", category: "article" },
  {
    domain: "open.spotify.com",
    category: "podcast",
    provider: "spotify",
    pathIncludes: [/^\/episode\//i, /^\/show\//i],
    confidence: 0.9,
    description: "spotify episode/show path",
  },
  { domain: "open.spotify.com", category: "music", provider: "spotify" },
  { domain: "spotify.com", category: "music", provider: "spotify" },
  { domain: "podcasts.apple.com", category: "podcast", provider: "apple" },
  { domain: "music.apple.com", category: "music", provider: "apple" },
  { domain: "netflix.com", category: "tv" },
  { domain: "hulu.com", category: "tv" },
  { domain: "itch.io", category: "software" },
  { domain: "eventbrite.com", category: "event" },
  { domain: "lu.ma", category: "event" },
  { domain: "arxiv.org", category: "research" },
  { domain: "doi.org", category: "research" },
];

const PATH_CATEGORY_RULES: PathRule[] = [
  { test: /\brecipe(s)?\b/i, category: "recipe" },
  { test: /\bpodcast(s)?\b|\/episode\//i, category: "podcast" },
  { test: /\bcourse(s)?\b|tutorial|bootcamp|lesson|learn/i, category: "course" },
  { test: /\bresearch\b|arxiv|doi\.org|paper\b/i, category: "research" },
  { test: /\bevent\b|webinar|meetup|conference/i, category: "event" },
  { test: /shop|store|product|listing|item|cart/i, category: "product" },
  { test: /music|album|track|mixtape/i, category: "music" },
  { test: /movie|film|trailer/i, category: "movie" },
  { test: /series|season|episode/i, category: "tv" },
];

const PROVIDER_CATEGORY_HINTS: Record<string, LinkCategory> = {
  youtube: "tv",
  youtu: "tv",
  spotify: "music",
  soundcloud: "music",
  bandcamp: "music",
  github: "software",
  gitlab: "software",
  bitbucket: "software",
  npm: "software",
  pypi: "software",
  dribbble: "design_portfolio",
  behance: "design_portfolio",
  figma: "design_portfolio",
  medium: "article",
  substack: "article",
  devto: "article",
  imdb: "movie",
  goodreads: "book",
  kindle: "book",
};

const HEURISTIC_KEYWORDS: Array<{ keyword: RegExp; category: LinkCategory }> = [
  { keyword: /blog|post/i, category: "article" },
  { keyword: /news|press/i, category: "news" },
  { keyword: /doc(s)?\/|documentation|changelog/i, category: "software" },
  { keyword: /design|portfolio/i, category: "design_portfolio" },
];

const stripSubdomains = (hostname: string): string => {
  const parts = hostname.toLowerCase().split(".");
  if (parts.length <= 2) return hostname.toLowerCase();
  return parts.slice(parts.length - 2).join(".");
};

const hostnameMatches = (hostname: string, candidate: string) => {
  if (hostname === candidate) return true;
  return hostname.endsWith(`.${candidate}`);
};

const isAllowedCategory = (value: string): value is LinkCategory =>
  (LINK_CATEGORIES as readonly string[]).includes(value);

const pickDomainRule = (
  parsed: URL | null
): DomainRule | null => {
  if (!parsed?.hostname) return null;
  const hostname = parsed.hostname.toLowerCase();
  const apex = stripSubdomains(hostname);

  for (const rule of DOMAIN_RULES) {
    if (!hostnameMatches(hostname, rule.domain) && !hostnameMatches(apex, rule.domain)) {
      continue;
    }

    if (rule.pathIncludes && rule.pathIncludes.length > 0) {
      const matchesPathRule = rule.pathIncludes.some((regex) => regex.test(parsed.pathname || ""));
      if (!matchesPathRule) {
        continue;
      }
    }

    return rule;
  }

  return null;
};

const pickPathRule = (pathname: string | undefined): PathRule | null => {
  if (!pathname) return null;
  for (const rule of PATH_CATEGORY_RULES) {
    if (rule.test.test(pathname)) {
      return rule;
    }
  }
  return null;
};

const pickProviderMapping = (hostname: string | undefined): { provider: string; category: LinkCategory } | null => {
  if (!hostname) return null;
  const hostText = hostname.toLowerCase();
  for (const [provider, category] of Object.entries(PROVIDER_CATEGORY_HINTS)) {
    if (hostText.includes(provider)) {
      return { provider, category };
    }
  }
  return null;
};

const pickHeuristicCategory = (text: string): LinkCategory | null => {
  for (const entry of HEURISTIC_KEYWORDS) {
    if (entry.keyword.test(text)) {
      return entry.category;
    }
  }
  return null;
};

export const resolveLinkCategory = (
  url: string,
  options?: { siteName?: string; title?: string }
): LinkCategoryResolution => {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }

  const hostname = parsed?.hostname?.toLowerCase();
  const pathname = parsed?.pathname ?? "";
  const ambientText = `${options?.siteName ?? ""} ${options?.title ?? ""}`.toLowerCase();
  const providerMatch = pickProviderMapping(hostname);

  const domainRule = pickDomainRule(parsed);
  if (domainRule && isAllowedCategory(domainRule.category)) {
    return {
      category: domainRule.category,
      confidence: domainRule.confidence ?? DEFAULT_DOMAIN_CONFIDENCE,
      provider: domainRule.provider ?? providerMatch?.provider,
      reason: "domain_rule",
      rule: domainRule.description ?? domainRule.domain,
    };
  }

  const pathRule = pickPathRule(pathname);
  if (pathRule && isAllowedCategory(pathRule.category)) {
    return {
      category: pathRule.category,
      confidence: pathRule.confidence ?? DEFAULT_PATH_CONFIDENCE,
      provider: providerMatch?.provider,
      reason: "path_rule",
      rule: pathRule.description ?? pathRule.test.source,
    };
  }

  if (providerMatch && isAllowedCategory(providerMatch.category)) {
    return {
      category: providerMatch.category,
      provider: providerMatch.provider,
      confidence: PROVIDER_CONFIDENCE,
      reason: "provider_mapping",
      rule: providerMatch.provider,
    };
  }

  const heuristicCategory = pickHeuristicCategory(`${hostname ?? ""} ${pathname} ${ambientText}`);
  if (heuristicCategory && isAllowedCategory(heuristicCategory)) {
    return {
      category: heuristicCategory,
      confidence: HEURISTIC_CONFIDENCE,
      reason: "heuristic",
    };
  }

  return {
    category: "other",
    confidence: FALLBACK_CONFIDENCE,
    reason: "fallback",
  };
};
