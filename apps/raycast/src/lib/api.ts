import { environment } from "@raycast/api";
import { getPreferences } from "./preferences";

export type RaycastCard = {
  id: string;
  type: string;
  content: string;
  notes: string | null;
  url: string | null;
  tags: string[];
  aiTags: string[];
  aiSummary: string | null;
  isFavorited: boolean;
  createdAt: number;
  updatedAt: number;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  screenshotUrl: string | null;
  linkPreviewImageUrl: string | null;
  metadataTitle: string | null;
  metadataDescription: string | null;
};

type CardsResponse = {
  items: RaycastCard[];
  total: number;
};

type QuickSaveResponse = {
  status: "created" | "duplicate";
  cardId: string;
};

const normalizeUrl = (url: string): string =>
  url.endsWith("/") ? url.slice(0, -1) : url;

const DEV_CONVEX_SITE_URL = "https://reminiscent-kangaroo-59.convex.site";
const PROD_CONVEX_SITE_URL = "https://uncommon-ladybug-882.convex.site";

const getConvexBaseUrl = (): string =>
  normalizeUrl(
    environment.isDevelopment ? DEV_CONVEX_SITE_URL : PROD_CONVEX_SITE_URL
  );

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const { apiKey } = getPreferences();

  if (!apiKey?.trim()) {
    throw new Error("missing_api_key");
  }

  const response = await fetch(`${getConvexBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401) {
    throw new Error("invalid_api_key");
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error || "request_failed");
  }

  return (await response.json()) as T;
};

export const quickSaveCard = async (
  content: string
): Promise<QuickSaveResponse> => {
  return request<QuickSaveResponse>("/api/raycast/quick-save", {
    method: "POST",
    body: JSON.stringify({ content }),
  });
};

export const searchCards = async (
  query: string,
  limit = 50
): Promise<CardsResponse> => {
  const search = new URLSearchParams();
  if (query.trim()) {
    search.set("q", query.trim());
  }
  search.set("limit", String(limit));

  return request<CardsResponse>(`/api/raycast/search?${search.toString()}`, {
    method: "GET",
  });
};

export const getFavoriteCards = async (
  query: string,
  limit = 50
): Promise<CardsResponse> => {
  const search = new URLSearchParams();
  if (query.trim()) {
    search.set("q", query.trim());
  }
  search.set("limit", String(limit));

  return request<CardsResponse>(`/api/raycast/favorites?${search.toString()}`, {
    method: "GET",
  });
};
