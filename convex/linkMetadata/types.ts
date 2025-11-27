import type { Id } from "../_generated/dataModel";

export interface ScrapeAttribute {
  name: string;
  value: string;
}

export interface ScrapeResultItem {
  text?: string;
  html?: string;
  attributes?: ScrapeAttribute[];
}

export interface ScrapeSelectorResult {
  selector: string;
  results: ScrapeResultItem[];
}

export interface ScrapeResponse {
  success: boolean;
  result?: ScrapeSelectorResult[];
  errors?: Array<{ code?: number; message?: string }>;
}

export interface LinkPreviewMetadata {
  source: "kernel_playwright";
  status: "success" | "error";
  fetchedAt: number;
  url: string;
  finalUrl?: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  faviconUrl?: string;
  siteName?: string;
  author?: string;
  publisher?: string;
  publishedAt?: string;
  screenshotStorageId?: Id<"_storage">;
  screenshotUpdatedAt?: number;
  error?: {
    type?: string;
    message?: string;
    details?: any;
  };
  raw?: ScrapeSelectorResult[];
}

export type SelectorSource = {
  selector: string;
  attribute: "content" | "href" | "text";
};
