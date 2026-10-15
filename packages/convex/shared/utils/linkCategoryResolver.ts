import {
  LINK_CATEGORIES,
  type LinkCategory,
  MASTODON_HOSTS,
} from "../linkCategories";

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

interface DomainRule {
  category: LinkCategory;
  confidence?: number;
  description?: string;
  domain: string;
  /** Match the domain itself (or its `www.`) only, never other subdomains. */
  exactHost?: boolean;
  pathIncludes?: RegExp[];
  provider?: string;
}

interface PathRule {
  category: LinkCategory;
  confidence?: number;
  description?: string;
  test: RegExp;
}

const DEFAULT_DOMAIN_CONFIDENCE = 0.98;
const DEFAULT_PATH_CONFIDENCE = 0.8;
const PROVIDER_CONFIDENCE = 0.72;
const HEURISTIC_CONFIDENCE = 0.58;
const FALLBACK_CONFIDENCE = 0.35;

// First path segments on code hosts that are site pages, not owners.
const CODE_HOST_RESERVED_SEGMENTS = [
  "-",
  "about",
  "account",
  "apps",
  "collections",
  "contact",
  "customer-stories",
  "dashboard",
  "enterprise",
  "events",
  "explore",
  "features",
  "groups",
  "help",
  "login",
  "marketplace",
  "new",
  "notifications",
  "org",
  "orgs",
  "pricing",
  "readme",
  "repo",
  "search",
  "security",
  "settings",
  "site",
  "solutions",
  "sponsors",
  "team",
  "topics",
  "trending",
  "user",
  "users",
];

// `/<owner>/<repo>` and anything deeper, unless the owner is a site page.
const REPO_PATH = new RegExp(
  `^/(?!(?:${CODE_HOST_RESERVED_SEGMENTS.join("|")})(?:/|$))[^/]+/[^/]+`,
  "i"
);
// sourcehut owners start with `~`.
const SOURCEHUT_REPO_PATH = /^\/~[^/]+\/[^/]+/;
const MASTODON_STATUS_PATH = /^\/@[^/]+\/\d+\/?$/;
const X_STATUS_PATH = /\/status(?:es)?\/\d+/i;
const THREADS_POST_PATH = /^\/@[^/]+\/post\/[^/]+/i;

const repoRule = (domain: string, provider?: string): DomainRule => ({
  domain,
  category: "repo",
  exactHost: true,
  pathIncludes: [domain.endsWith("sr.ht") ? SOURCEHUT_REPO_PATH : REPO_PATH],
  description: `${domain} repository`,
  ...(provider ? { provider } : {}),
});

const DOMAIN_RULES: DomainRule[] = [
  repoRule("github.com", "github"),
  repoRule("gitlab.com"),
  repoRule("bitbucket.org"),
  repoRule("codeberg.org"),
  repoRule("git.sr.ht"),
  repoRule("hg.sr.ht"),
  // Social posts. Substack Notes sits before Substack's article rule.
  { domain: "x.com", category: "social_post", pathIncludes: [X_STATUS_PATH] },
  {
    domain: "twitter.com",
    category: "social_post",
    pathIncludes: [X_STATUS_PATH],
  },
  {
    domain: "instagram.com",
    category: "social_post",
    pathIncludes: [/^\/(?:[^/]+\/)?(?:p|reel)\/[^/]+/i],
  },
  {
    domain: "bsky.app",
    category: "social_post",
    pathIncludes: [/^\/profile\/[^/]+\/post\/[^/]+/i],
  },
  {
    domain: "threads.net",
    category: "social_post",
    pathIncludes: [THREADS_POST_PATH],
  },
  {
    domain: "threads.com",
    category: "social_post",
    pathIncludes: [THREADS_POST_PATH],
  },
  {
    domain: "tiktok.com",
    category: "social_post",
    pathIncludes: [/^\/@[^/]+\/video\/\d+/i],
  },
  {
    domain: "reddit.com",
    category: "social_post",
    pathIncludes: [/\/comments\/[a-z0-9]+/i],
  },
  {
    domain: "linkedin.com",
    category: "social_post",
    pathIncludes: [/^\/posts\/[^/]+/i, /^\/feed\/update\/[^/]+/i],
  },
  {
    domain: "substack.com",
    category: "social_post",
    pathIncludes: [/\/note\/[^/]+/i],
  },
  ...MASTODON_HOSTS.map(
    (domain): DomainRule => ({
      domain,
      category: "social_post",
      exactHost: true,
      pathIncludes: [MASTODON_STATUS_PATH],
      description: `${domain} status`,
    })
  ),
  // Apps
  { domain: "apps.apple.com", category: "app", pathIncludes: [/\/app\//i] },
  {
    domain: "play.google.com",
    category: "app",
    pathIncludes: [/^\/store\/apps\//i],
  },
  {
    domain: "chromewebstore.google.com",
    category: "app",
    pathIncludes: [/^\/detail\//i],
  },
  {
    domain: "chrome.google.com",
    category: "app",
    pathIncludes: [/^\/webstore\/detail\//i],
  },
  {
    domain: "apps.microsoft.com",
    category: "app",
    pathIncludes: [/\/detail\//i],
  },
  // Games
  {
    domain: "store.steampowered.com",
    category: "game",
    pathIncludes: [/^\/app\//i],
  },
  { domain: "itch.io", category: "game" },
  { domain: "store.epicgames.com", category: "game" },
  { domain: "gog.com", category: "game", pathIncludes: [/\/game\//i] },
  {
    domain: "boardgamegeek.com",
    category: "game",
    pathIncludes: [/^\/boardgame\//i],
  },
  // Places: maps, food and travel, real estate
  {
    domain: "google.com",
    category: "place",
    pathIncludes: [/^\/maps(?:\/|$)/i],
  },
  { domain: "maps.google.com", category: "place" },
  { domain: "maps.app.goo.gl", category: "place" },
  { domain: "goo.gl", category: "place", pathIncludes: [/^\/maps\//i] },
  { domain: "maps.apple.com", category: "place" },
  { domain: "yelp.com", category: "place", pathIncludes: [/^\/biz\//i] },
  { domain: "tripadvisor.com", category: "place" },
  { domain: "opentable.com", category: "place" },
  { domain: "resy.com", category: "place" },
  { domain: "airbnb.com", category: "place", pathIncludes: [/^\/rooms\//i] },
  { domain: "booking.com", category: "place", pathIncludes: [/^\/hotel\//i] },
  {
    domain: "zillow.com",
    category: "place",
    pathIncludes: [/^\/homedetails\//i],
  },
  { domain: "redfin.com", category: "place" },
  {
    domain: "rightmove.co.uk",
    category: "place",
    pathIncludes: [/^\/properties\//i],
  },
  { domain: "realtor.com", category: "place" },
  // Typefaces
  {
    domain: "fonts.google.com",
    category: "typeface",
    pathIncludes: [/^\/specimen\//i],
  },
  {
    domain: "fonts.adobe.com",
    category: "typeface",
    pathIncludes: [/^\/fonts\//i],
  },
  { domain: "myfonts.com", category: "typeface" },
  { domain: "fontshare.com", category: "typeface" },
  { domain: "futurefonts.xyz", category: "typeface" },
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
  {
    domain: "dribbble.com",
    category: "design_portfolio",
    provider: "dribbble",
  },
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
  { domain: "eventbrite.com", category: "event" },
  { domain: "lu.ma", category: "event" },
  { domain: "arxiv.org", category: "research" },
  { domain: "doi.org", category: "research" },
];

const PATH_CATEGORY_RULES: PathRule[] = [
  { test: /\brecipe(s)?\b/i, category: "recipe" },
  { test: /\bpodcast(s)?\b|\/episode\//i, category: "podcast" },
  {
    test: /\bcourse(s)?\b|tutorial|bootcamp|lesson|learn/i,
    category: "course",
  },
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
  if (parts.length <= 2) {
    return hostname.toLowerCase();
  }
  return parts.slice(parts.length - 2).join(".");
};

const hostnameMatches = (hostname: string, candidate: string) => {
  if (hostname === candidate) {
    return true;
  }
  return hostname.endsWith(`.${candidate}`);
};

const isAllowedCategory = (value: string): value is LinkCategory =>
  (LINK_CATEGORIES as readonly string[]).includes(value);

const pickDomainRule = (parsed: URL | null): DomainRule | null => {
  if (!parsed?.hostname) {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  const apex = stripSubdomains(hostname);

  for (const rule of DOMAIN_RULES) {
    const hostMatches = rule.exactHost
      ? hostname === rule.domain || hostname === `www.${rule.domain}`
      : hostnameMatches(hostname, rule.domain) ||
        hostnameMatches(apex, rule.domain);
    if (!hostMatches) {
      continue;
    }

    if (rule.pathIncludes && rule.pathIncludes.length > 0) {
      const matchesPathRule = rule.pathIncludes.some((regex) =>
        regex.test(parsed.pathname || "")
      );
      if (!matchesPathRule) {
        continue;
      }
    }

    return rule;
  }

  return null;
};

const pickPathRule = (pathname: string | undefined): PathRule | null => {
  if (!pathname) {
    return null;
  }
  for (const rule of PATH_CATEGORY_RULES) {
    if (rule.test.test(pathname)) {
      return rule;
    }
  }
  return null;
};

const pickProviderMapping = (
  hostname: string | undefined
): { provider: string; category: LinkCategory } | null => {
  if (!hostname) {
    return null;
  }
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
  const ambientText =
    `${options?.siteName ?? ""} ${options?.title ?? ""}`.toLowerCase();
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

  const heuristicCategory = pickHeuristicCategory(
    `${hostname ?? ""} ${pathname} ${ambientText}`
  );
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
