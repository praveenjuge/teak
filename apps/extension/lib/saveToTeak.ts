import type { TeakSaveResponse } from "../types/messages";
import { isSupportedInlineSaveHost } from "../types/social";
import { oauthRequest } from "./oauthAuth";

export type SaveSource =
  | "context-menu"
  | "context-menu-asset"
  | "inline-post"
  | "popup-auto-save"
  | "popup-file";
export interface SaveToTeakInput {
  content: string;
  enforceAllowedHosts?: boolean;
  idempotencyKey?: string;
  source: SaveSource;
}
export interface SaveToTeakDependencies {
  fetchImpl?: typeof fetch;
  request?: typeof oauthRequest;
}
const isHttpUrl = (value: string) =>
  value.startsWith("http://") || value.startsWith("https://");
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

export async function restResult(
  response: Response | null
): Promise<TeakSaveResponse> {
  if (!response) {
    return { status: "unauthenticated" };
  }
  const payload: unknown = await response.json();
  const body: Record<string, unknown> =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  if (!response.ok) {
    return {
      status: "error",
      code: typeof body.code === "string" ? body.code : undefined,
      message:
        typeof body.error === "string" ? body.error : "Could not save content.",
    };
  }
  if (typeof body.cardId !== "string") {
    throw new Error("Invalid save response.");
  }
  return { status: "saved", cardId: body.cardId };
}

export async function saveToTeak(
  input: SaveToTeakInput,
  dependencies: SaveToTeakDependencies = {}
): Promise<TeakSaveResponse> {
  if (!input.content.trim()) {
    return {
      status: "error",
      message: "No content to save",
      code: "EMPTY_CONTENT",
    };
  }
  const parsedUrl = parseContentAsUrl(input.content.trim());
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
  const request = dependencies.request ?? oauthRequest;
  try {
    const content = parsedUrl ? parsedUrl.toString() : input.content;
    if (parsedUrl) {
      const response = await request(
        `/v1/cards/duplicate?url=${encodeURIComponent(content)}`
      );
      if (!response) {
        return { status: "unauthenticated" };
      }
      if (!response.ok) {
        return restResult(response);
      }
      const duplicate = await response.json();
      if (duplicate.cardId) {
        return { status: "duplicate", cardId: duplicate.cardId };
      }
    }
    return await restResult(
      await request("/v1/cards", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey ?? crypto.randomUUID(),
        },
        body: JSON.stringify(
          parsedUrl ? { url: content } : { content, cardType: "text" }
        ),
      })
    );
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Failed to save content",
    };
  }
}
