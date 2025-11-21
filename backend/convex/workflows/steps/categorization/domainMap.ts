import type { LinkCategory } from "@teak/convex/shared";

type DomainRule = {
  domain: string;
  category: LinkCategory;
  provider?: string;
};

// Cheap, deterministic routing for the highest volume domains to avoid LLM calls.
// Keep list short and easy to reason about.
export const DOMAIN_CATEGORY_RULES: DomainRule[] = [
  { domain: "github.com", category: "software", provider: "github" },
  { domain: "gitlab.com", category: "software" },
  { domain: "bitbucket.org", category: "software" },
  { domain: "npmjs.com", category: "software" },
  { domain: "pypi.org", category: "software" },
  { domain: "rubygems.org", category: "software" },
  { domain: "imdb.com", category: "movie", provider: "imdb" },
  { domain: "goodreads.com", category: "book", provider: "goodreads" },
  { domain: "amazon.com", category: "product", provider: "amazon" },
  { domain: "amazon.co.uk", category: "product", provider: "amazon" },
  { domain: "amazon.in", category: "product", provider: "amazon" },
  { domain: "dribbble.com", category: "design_portfolio", provider: "dribbble" },
  { domain: "behance.net", category: "design_portfolio" },
  { domain: "figma.com", category: "design_portfolio" },
  { domain: "youtube.com", category: "tv" },
  { domain: "youtu.be", category: "tv" },
  { domain: "medium.com", category: "article" },
  { domain: "substack.com", category: "article" },
  { domain: "dev.to", category: "article" },
  { domain: "spotify.com", category: "music" },
  { domain: "music.apple.com", category: "music" },
  { domain: "open.spotify.com", category: "music" },
  { domain: "netflix.com", category: "tv" },
  { domain: "itch.io", category: "software" },
];

// Some domains imply a provider but not necessarily category; map separately.
export const DOMAIN_PROVIDER_HINT: Record<string, string> = {
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "open.spotify.com": "spotify",
  "spotify.com": "spotify",
  "music.apple.com": "apple",
  "figma.com": "figma",
};

const stripSubdomains = (hostname: string): string => {
  const parts = hostname.toLowerCase().split(".");
  if (parts.length <= 2) return hostname.toLowerCase();
  return parts.slice(parts.length - 2).join(".");
};

// Return category/provider for a hostname when we have a deterministic rule.
export const matchDomainCategory = (
  hostname: string | undefined
): { category: LinkCategory; provider?: string } | null => {
  if (!hostname) return null;

  const normalizedHost = hostname.toLowerCase();
  const apex = stripSubdomains(normalizedHost);

  const rule =
    DOMAIN_CATEGORY_RULES.find(
      (entry) =>
        normalizedHost === entry.domain || apex === entry.domain || normalizedHost.endsWith(`.${entry.domain}`)
    ) ?? null;

  if (!rule) return null;

  // Some entries use a placeholder (e.g., "video") not present in LinkCategory union. Fallback to tv/movie.
  const category = rule.category === ("video" as LinkCategory) ? ("tv" as LinkCategory) : rule.category;

  const provider = rule.provider ?? DOMAIN_PROVIDER_HINT[normalizedHost] ?? DOMAIN_PROVIDER_HINT[apex];
  return { category, provider };
};
