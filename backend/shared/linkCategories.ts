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
] as const;

export type LinkCategory = (typeof LINK_CATEGORIES)[number];

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
  software: "Software / App / GitHub Project",
  design_portfolio: "Design Portfolio",
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
};

export interface LinkCategoryDetail {
  label: string;
  value: string;
  icon?: string;
}

export interface LinkCategoryMetadata {
  category: LinkCategory;
  confidence?: number;
  detectedProvider?: string;
  fetchedAt: number;
  sourceUrl: string;
  imageUrl?: string;
  facts?: LinkCategoryDetail[];
  raw?: Record<string, unknown>;
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
    if (!variant) return;
    const key = normalizeVariant(variant);
    if (!key) return;
    map[key] = category;
  };

  for (const category of LINK_CATEGORIES) {
    register(category, category);

    const label = LINK_CATEGORY_LABELS[category];
    register(label, category);

    for (const part of label.split(/[\/,|()-]/)) {
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
