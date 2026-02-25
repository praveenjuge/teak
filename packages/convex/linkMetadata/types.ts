import type { Id } from "../shared/types";

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
    primaryImage?: {
      url: string;
      width?: number;
      height?: number;
    };
  };
  success: boolean;
}

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
  imageStorageId?: Id<"_storage">;
  imageUpdatedAt?: number;
  imageUrl?: string;
  imageWidth?: number;
  publishedAt?: string;
  publisher?: string;
  raw?: ScrapeSelectorResult[];
  screenshotHeight?: number;
  screenshotStorageId?: Id<"_storage">;
  screenshotUpdatedAt?: number;
  screenshotWidth?: number;
  siteName?: string;
  source: "kernel_playwright";
  status: "success" | "error";
  title?: string;
  url: string;
}

export type SelectorSource = {
  selector: string;
  attribute: "content" | "href" | "text";
};
