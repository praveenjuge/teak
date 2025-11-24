import type { Id } from "../_generated/dataModel";

export interface CloudflareScrapeAttribute {
  name: string;
  value: string;
}

export interface CloudflareScrapeResultItem {
  text?: string;
  html?: string;
  attributes?: CloudflareScrapeAttribute[];
}

export interface CloudflareScrapeSelectorResult {
  selector: string;
  results: CloudflareScrapeResultItem[];
}

export interface CloudflareScrapeResponse {
  success: boolean;
  result?: CloudflareScrapeSelectorResult[];
  errors?: Array<{ code?: number; message?: string }>;
}

export interface LinkPreviewMetadata {
  source: "cloudflare_browser_rendering";
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
  raw?: CloudflareScrapeSelectorResult[];
}

export type SelectorSource = {
  selector: string;
  attribute: "content" | "href" | "text";
};
