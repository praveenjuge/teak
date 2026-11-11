import type { LinkCategory } from "@teak/convex/shared/linkCategories";
import type { FilesScrapeSelectorResult } from "@teak/files-protocol";

export interface ScrapeResponse {
  errors?: Array<{ code?: number; message?: string }>;
  result?: {
    selectors: FilesScrapeSelectorResult[];
  };
  success: boolean;
}

// Stored on every scraped preview; named after a retired renderer, so
// changing it needs a migration of stored previews.
export const TEAK_SCRAPER_SOURCE = "kernel_playwright";

export interface LinkPreviewMetadata {
  author?: string;
  canonicalUrl?: string;
  categoryHint?: LinkCategory;
  description?: string;
  error?: {
    type?: string;
    message?: string;
    details?: unknown;
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
  raw?: FilesScrapeSelectorResult[];
  rawSha256?: string;
  rawStorageKey?: string;
  screenshotBytes?: number;
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
