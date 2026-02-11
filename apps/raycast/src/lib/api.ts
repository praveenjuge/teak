import { environment } from "@raycast/api";
import {
  buildCardsSearchParams,
  RaycastApiError,
  type RaycastApiErrorCode,
  toErrorCode,
} from "./apiErrors";
import { getPreferences } from "./preferences";

export {
  buildCardsSearchParams,
  getRecoveryHint,
  getUserFacingErrorMessage,
  RaycastApiError,
  type RaycastApiErrorCode,
} from "./apiErrors";

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

type ApiErrorPayload = {
  error?: string;
  code?: string;
};

const DEFAULT_LIMIT = 50;
const DEV_CONVEX_SITE_URL = "https://reminiscent-kangaroo-59.convex.site";
const PROD_CONVEX_SITE_URL = "https://uncommon-ladybug-882.convex.site";

const normalizeUrl = (url: string): string =>
  url.endsWith("/") ? url.slice(0, -1) : url;

const getConvexBaseUrl = (): string =>
  normalizeUrl(
    environment.isDevelopment ? DEV_CONVEX_SITE_URL : PROD_CONVEX_SITE_URL,
  );

const getErrorCodeFromResponse = (
  payloadCode: string | undefined,
  status: number,
): RaycastApiErrorCode => {
  if (status === 401) {
    return toErrorCode(payloadCode, "INVALID_API_KEY");
  }

  if (status === 429) {
    return "RATE_LIMITED";
  }

  return toErrorCode(payloadCode, "REQUEST_FAILED");
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const { apiKey } = getPreferences();

  if (!apiKey?.trim()) {
    throw new RaycastApiError("MISSING_API_KEY");
  }

  let response: Response;

  try {
    response = await fetch(`${getConvexBaseUrl()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new RaycastApiError("NETWORK_ERROR");
  }

  if (response.ok) {
    return (await response.json()) as T;
  }

  const payload = (await response
    .json()
    .catch(() => null)) as ApiErrorPayload | null;

  throw new RaycastApiError(
    getErrorCodeFromResponse(payload?.code, response.status),
    response.status,
  );
};

export const quickSaveCard = async (
  content: string,
): Promise<QuickSaveResponse> => {
  return request<QuickSaveResponse>("/api/raycast/quick-save", {
    method: "POST",
    body: JSON.stringify({ content }),
  });
};

export const searchCards = async (
  query: string,
  limit = DEFAULT_LIMIT,
): Promise<CardsResponse> => {
  return request<CardsResponse>(
    `/api/raycast/search?${buildCardsSearchParams(query, limit)}`,
    {
      method: "GET",
    },
  );
};

export const getFavoriteCards = async (
  query: string,
  limit = DEFAULT_LIMIT,
): Promise<CardsResponse> => {
  return request<CardsResponse>(
    `/api/raycast/favorites?${buildCardsSearchParams(query, limit)}`,
    {
      method: "GET",
    },
  );
};
