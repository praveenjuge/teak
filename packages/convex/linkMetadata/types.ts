export interface ScrapeAttribute {
  name: string;
  value: string;
}

export interface ScrapeResultItem {
  attributes?: ScrapeAttribute[];
  html?: string;
  text?: string;
}

export interface ScrapeSelectorResult {
  results: ScrapeResultItem[];
  selector: string;
}

export interface ScrapeResponse {
  errors?: Array<{ code?: number; message?: string }>;
  result?: {
    selectors: ScrapeSelectorResult[];
  };
  success: boolean;
}

/**
 * The stored source of every preview Teak scrapes itself, named after a
 * retired renderer. Clients and stored previews read it as Teak's own scraper.
 */
export const TEAK_SCRAPER_SOURCE = "kernel_playwright";

export interface LinkPreviewMetadata {
  author?: string;
  canonicalUrl?: string;
  description?: string;
  error?: {
    type?: string;
    message?: string;
    details?: any;
  };
  faviconUrl?: string;
  fetchedAt: number;
  finalUrl?: string;
  imageHeight?: number;
  imageStorageKey?: string;
  imageUpdatedAt?: number;
  imageUrl?: string;
  imageWidth?: number;
  media?: LinkPreviewMediaItem[];
  publishedAt?: string;
  publisher?: string;
  raw?: ScrapeSelectorResult[];
  rawSha256?: string;
  rawStorageKey?: string;
  screenshotHeight?: number;
  screenshotStorageKey?: string;
  screenshotUpdatedAt?: number;
  screenshotWidth?: number;
  siteName?: string;
  source: typeof TEAK_SCRAPER_SOURCE;
  status: "success" | "error";
  title?: string;
  url: string;
}

export interface LinkPreviewMediaItem {
  contentType?: string;
  height?: number;
  posterContentType?: string;
  posterHeight?: number;
  posterStorageKey?: string;
  posterUpdatedAt?: number;
  posterWidth?: number;
  storageKey?: string;
  type: "image" | "video";
  updatedAt: number;
  width?: number;
}

export interface SelectorSource {
  attribute: "content" | "href" | "text";
  selector: string;
}
