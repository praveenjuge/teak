import type { StorageRef } from "../storageRefs";

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
    instagramMedia?: Array<{
      contentType?: string;
      height?: number;
      posterContentType?: string;
      posterHeight?: number;
      posterUrl?: string;
      posterWidth?: number;
      type?: "image" | "video";
      url?: string;
      width?: number;
    }>;
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
  imageStorageId?: StorageRef;
  imageUpdatedAt?: number;
  imageUrl?: string;
  imageWidth?: number;
  media?: LinkPreviewMediaItem[];
  publishedAt?: string;
  publisher?: string;
  raw?: ScrapeSelectorResult[];
  screenshotHeight?: number;
  screenshotStorageId?: StorageRef;
  screenshotUpdatedAt?: number;
  screenshotWidth?: number;
  siteName?: string;
  source: "kernel_playwright";
  status: "success" | "error";
  title?: string;
  url: string;
}

export interface LinkPreviewMediaItem {
  contentType?: string;
  height?: number;
  posterContentType?: string;
  posterHeight?: number;
  posterStorageId?: StorageRef;
  posterUpdatedAt?: number;
  posterWidth?: number;
  storageId: StorageRef;
  type: "image" | "video";
  updatedAt: number;
  width?: number;
}

export type SelectorSource = {
  selector: string;
  attribute: "content" | "href" | "text";
};
