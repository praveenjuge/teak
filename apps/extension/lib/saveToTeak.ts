import { ConvexHttpClient } from "convex/browser";
import type { TeakSaveResponse } from "../types/messages";
import { isSupportedInlineSaveHost } from "../types/social";
import { api } from "./convex-api";
import {
  clearLocalSession,
  getConvexSiteUrl,
  getSessionToken,
} from "./nativeAuth";

const CARD_LIMIT_REACHED_CODE = "CARD_LIMIT_REACHED";
const JWT_EXPIRY_SKEW_MS = 10_000;

export type SaveSource =
  | "context-menu"
  | "context-menu-asset"
  | "inline-post"
  | "popup-auto-save"
  | "popup-file";

interface SaveToTeakInput {
  content: string;
  enforceAllowedHosts?: boolean;
  source: SaveSource;
}

export interface ConvexClientLike {
  action: ConvexHttpClient["action"];
  mutation: ConvexHttpClient["mutation"];
  query: ConvexHttpClient["query"];
}

export interface SaveToTeakDependencies {
  createClient?: (token: string) => ConvexClientLike;
  fetchImpl?: typeof fetch;
  getSessionToken?: () => Promise<string | null>;
  now?: () => number;
}

interface CachedToken {
  expiresAt: number;
  token: string;
}

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
  return;
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

  const resolveSessionToken = dependencies.getSessionToken ?? getSessionToken;
  const sessionToken = await resolveSessionToken();
  if (!sessionToken) {
    return null;
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${getConvexSiteUrl()}/api/auth/convex/token`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    }
  );

  if (response.status === 401 || response.status === 403) {
    // The stored session is dead: drop the cached JWT and local session so the
    // next attempt reports signed-out instead of retrying a doomed token.
    cachedConvexToken = null;
    await clearLocalSession();
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

export const getAuthenticatedConvexClient = async (
  dependencies: SaveToTeakDependencies = {}
): Promise<ConvexClientLike | null> => {
  const convexToken = await getConvexAuthToken(dependencies);
  if (!convexToken) {
    return null;
  }
  return (
    dependencies.createClient?.(convexToken) ?? createDefaultClient(convexToken)
  );
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

  let client: ConvexClientLike | null;
  try {
    client = await getAuthenticatedConvexClient(dependencies);
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      status: "error",
      message,
      code: getErrorCode(message),
    };
  }

  if (!client) {
    return { status: "unauthenticated" };
  }

  try {
    const normalizedContent = parsedUrl ? parsedUrl.toString() : input.content;

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
      type: parsedUrl ? undefined : "text",
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
