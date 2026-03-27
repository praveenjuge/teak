import { resolveTeakDevAppUrl } from "@teak/config/dev-urls";
import { ConvexHttpClient } from "convex/browser";
import type { TeakSaveResponse } from "../types/messages";
import { isSupportedInlineSaveHost } from "../types/social";
import { getSessionTokenFromCookies } from "../utils/getSessionFromCookies";
import { api } from "./convex-api";

const CARD_LIMIT_REACHED_CODE = "CARD_LIMIT_REACHED";
const JWT_EXPIRY_SKEW_MS = 10_000;

const WEB_APP_BASE_URL = import.meta.env.DEV
  ? resolveTeakDevAppUrl(import.meta.env)
  : "https://app.teakvault.com";

type SaveSource = "context-menu" | "inline-post" | "popup-auto-save";

type SaveToTeakInput = {
  content: string;
  enforceAllowedHosts?: boolean;
  source: SaveSource;
};

type ConvexClientLike = {
  mutation: ConvexHttpClient["mutation"];
  query: ConvexHttpClient["query"];
};

type SaveToTeakDependencies = {
  createClient?: (token: string) => ConvexClientLike;
  fetchImpl?: typeof fetch;
  getSessionToken?: () => Promise<string | null>;
  now?: () => number;
};

type CachedToken = {
  expiresAt: number;
  token: string;
};

let cachedConvexToken: CachedToken | null = null;

const isHttpUrl = (value: string): boolean =>
  value.startsWith("http://") || value.startsWith("https://");

const parseJwtExpiry = (token: string): number | null => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    if (typeof payload.exp !== "number") {
      return null;
    }
    return payload.exp * 1000;
  } catch {
    return null;
  }
};

const getConvexDeploymentUrl = (): string => {
  const url = import.meta.env.VITE_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("Missing VITE_PUBLIC_CONVEX_URL in extension runtime");
  }
  return url;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Failed to save content";

const getErrorCode = (message: string): string | undefined => {
  if (message.includes(CARD_LIMIT_REACHED_CODE)) {
    return CARD_LIMIT_REACHED_CODE;
  }
  return undefined;
};

const parseContentAsUrl = (content: string): URL | null => {
  if (!isHttpUrl(content)) {
    return null;
  }

  try {
    const parsed = new URL(content);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const isAllowedInlineHost = (hostname: string): boolean =>
  isSupportedInlineSaveHost(hostname.toLowerCase());

const getConvexAuthToken = async (
  dependencies: SaveToTeakDependencies
): Promise<string | null> => {
  const now = dependencies.now ?? Date.now;
  if (
    cachedConvexToken &&
    cachedConvexToken.expiresAt > now() + JWT_EXPIRY_SKEW_MS
  ) {
    return cachedConvexToken.token;
  }

  const getSessionToken =
    dependencies.getSessionToken ?? getSessionTokenFromCookies;
  const sessionToken = await getSessionToken();
  if (!sessionToken) {
    return null;
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${WEB_APP_BASE_URL}/api/clerk/convex-token`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    }
  );

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Failed to fetch Convex auth token");
  }

  const data = (await response.json()) as { token?: unknown };
  if (typeof data.token !== "string" || !data.token.trim()) {
    throw new Error("Convex auth token response is invalid");
  }

  const expiresAt = parseJwtExpiry(data.token) ?? now() + 5 * 60 * 1000;
  cachedConvexToken = {
    token: data.token,
    expiresAt,
  };

  return data.token;
};

const createDefaultClient = (token: string): ConvexClientLike => {
  const client = new ConvexHttpClient(getConvexDeploymentUrl());
  client.setAuth(token);
  return client;
};

export function resetSaveToTeakTokenCache(): void {
  cachedConvexToken = null;
}

export async function saveToTeak(
  input: SaveToTeakInput,
  dependencies: SaveToTeakDependencies = {}
): Promise<TeakSaveResponse> {
  const trimmedContent = input.content.trim();
  if (!trimmedContent) {
    return {
      status: "error",
      message: "No content to save",
      code: "EMPTY_CONTENT",
    };
  }

  const parsedUrl = parseContentAsUrl(trimmedContent);
  if (
    input.enforceAllowedHosts &&
    !(parsedUrl && isAllowedInlineHost(parsedUrl.hostname))
  ) {
    return {
      status: "error",
      message: "Unsupported host for inline save",
      code: "UNSUPPORTED_HOST",
    };
  }

  let convexToken: string | null;
  try {
    convexToken = await getConvexAuthToken(dependencies);
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      status: "error",
      message,
      code: getErrorCode(message),
    };
  }

  if (!convexToken) {
    return { status: "unauthenticated" };
  }

  const client =
    dependencies.createClient?.(convexToken) ??
    createDefaultClient(convexToken);

  try {
    const normalizedContent = parsedUrl ? parsedUrl.toString() : trimmedContent;

    if (parsedUrl) {
      const duplicate = await client.query(api.cards.findDuplicateCard, {
        url: normalizedContent,
      });

      if (duplicate?._id) {
        return {
          status: "duplicate",
          cardId: String(duplicate._id),
        };
      }
    }

    const cardId = await client.mutation(api.cards.createCard, {
      content: normalizedContent,
    });

    return {
      status: "saved",
      cardId: String(cardId),
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      status: "error",
      message,
      code: getErrorCode(message),
    };
  }
}
