import type { LinkPrice } from "./price";

export const LINK_CATEGORIES = [
  "book",
  "movie",
  "tv",
  "article",
  "news",
  "podcast",
  "music",
  "product",
  "recipe",
  "course",
  "research",
  "event",
  "software",
  "design_portfolio",
  "place",
  "typeface",
  "social_post",
  "app",
  "game",
  "repo",
  "other",
] as const;

export type LinkCategory = (typeof LINK_CATEGORIES)[number];

export const isLinkCategory = (value: string): value is LinkCategory =>
  (LINK_CATEGORIES as readonly string[]).includes(value);

export const LINK_CATEGORY_LABELS: Record<LinkCategory, string> = {
  book: "Book / eBook",
  movie: "Movie / Film",
  tv: "TV Show / Series",
  article: "Article / Long-form Post",
  news: "News Brief / Blog Update",
  podcast: "Podcast Episode / Audio Show",
  music: "Music Track / Album",
  product: "Product / Shopping Page",
  recipe: "Recipe / Cooking Guide",
  course: "Course / Tutorial / Learning Resource",
  research: "Research Paper / Academic Publication",
  event: "Event / Webinar / Meetup",
  software: "Software / Developer Tool",
  design_portfolio: "Design Portfolio",
  place: "Place / Restaurant / Venue / Real Estate",
  typeface: "Typeface / Font",
  social_post: "Social Post",
  app: "App / Mobile or Desktop App",
  game: "Game / Video Game",
  repo: "Code Repository",
  other: "Other / Miscellaneous",
};

export const LINK_CATEGORY_ICONS: Record<LinkCategory, string> = {
  book: "Book",
  movie: "Clapperboard",
  tv: "Tv",
  article: "FileText",
  news: "Newspaper",
  podcast: "Podcast",
  music: "Music",
  product: "ShoppingBag",
  recipe: "Utensils",
  course: "GraduationCap",
  research: "Scroll",
  event: "CalendarDays",
  software: "Code",
  design_portfolio: "Palette",
  place: "MapPin",
  typeface: "Type",
  social_post: "MessageSquare",
  app: "AppWindow",
  game: "Gamepad2",
  repo: "FolderGit2",
  other: "Link",
};

export type LinkDoneVerb =
  | "read"
  | "watched"
  | "listened"
  | "bought"
  | "cooked"
  | "played"
  | "done";

/** What finishing a link of each category is called: "Mark as read". */
export const LINK_CATEGORY_DONE_VERB: Record<LinkCategory, LinkDoneVerb> = {
  book: "read",
  movie: "watched",
  tv: "watched",
  article: "read",
  news: "read",
  podcast: "listened",
  music: "listened",
  product: "bought",
  recipe: "cooked",
  course: "done",
  research: "read",
  event: "done",
  software: "done",
  design_portfolio: "done",
  place: "done",
  typeface: "done",
  social_post: "done",
  app: "done",
  game: "played",
  repo: "done",
  other: "done",
};

/** Link categories `is:todo` lists: things saved to read, watch or buy. */
export const ACTIONABLE_LINK_CATEGORIES: ReadonlySet<string> =
  new Set<LinkCategory>([
    "book",
    "movie",
    "tv",
    "article",
    "news",
    "podcast",
    "music",
    "product",
    "recipe",
    "course",
    "event",
    "app",
    "game",
  ]);

/** The done verb for a link's category; "done" when it has none or isn't known. */
export const doneActionLabel = (category?: string | null): LinkDoneVerb =>
  category && isLinkCategory(category)
    ? LINK_CATEGORY_DONE_VERB[category]
    : "done";

/**
 * Mastodon instances whose `/@user/<id>` paths the URL rules trust as posts.
 * The path alone is not enough (any blog can use it); other instances are
 * confirmed through their status API when the link's metadata is fetched.
 */
export const MASTODON_HOSTS = [
  "mastodon.social",
  "mastodon.online",
  "mas.to",
  "fosstodon.org",
  "hachyderm.io",
  "infosec.exchange",
  "mstdn.social",
] as const;

export interface LinkCategoryDetail {
  icon?: string;
  label: string;
  value: string;
}

export interface LinkCategoryMetadata {
  category: LinkCategory;
  confidence?: number;
  detectedProvider?: string;
  facts?: LinkCategoryDetail[];
  fetchedAt: number;
  imageUrl?: string;
  /** An arXiv paper's PDF on arxiv.org, which Save PDF stores as a document. */
  pdfUrl?: string;
  /** A product's price, from JSON-LD or the provider's page selectors. */
  price?: LinkPrice;
  raw?: Record<string, unknown>;
  rawHasStructured?: boolean;
  rawSha256?: string;
  rawStorageKey?: string;
  rawStructuredFetchedAt?: number;
  sourceUrl: string;
}

export const LINK_CATEGORY_DEFAULT_CONFIDENCE = 0.6;

const normalizeVariant = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildCategoryLookup = (): Record<string, LinkCategory> => {
  const map: Record<string, LinkCategory> = {};

  const register = (variant: string | undefined, category: LinkCategory) => {
    if (!variant) {
      return;
    }
    const key = normalizeVariant(variant);
    if (!key) {
      return;
    }
    map[key] = category;
  };

  for (const category of LINK_CATEGORIES) {
    register(category, category);

    const label = LINK_CATEGORY_LABELS[category];
    register(label, category);

    for (const part of label.split(/[/,|()-]/)) {
      register(part, category);
    }
  }

  return map;
};

const LINK_CATEGORY_LOOKUP = buildCategoryLookup();

export const normalizeLinkCategory = (value: string): LinkCategory | null => {
  const key = normalizeVariant(value);
  if (!key) {
    return null;
  }
  return LINK_CATEGORY_LOOKUP[key] ?? null;
};
