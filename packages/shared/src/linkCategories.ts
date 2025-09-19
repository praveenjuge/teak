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
