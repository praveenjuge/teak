import { truncateCodePoints } from "@teak/convex/shared/utils/codePoints";
import { TeakApiError, type TeakClient } from "teak-sdk";
import type { TeakSaveResponse } from "../types/messages";
import { isSupportedInlineSaveHost } from "../types/social";
import { inExtensionWords, isSignedOut, teakClient } from "./oauthAuth";
import { type PageSnapshot, uploadPageSnapshot } from "./pageSnapshot";

export type SaveSource =
  | "context-menu"
  | "context-menu-asset"
  | "inline-post"
  | "popup-auto-save"
  | "popup-file"
  | "shortcut";
export interface SaveToTeakInput {
  content: string;
  enforceAllowedHosts?: boolean;
  idempotencyKey?: string;
  /**
   * The snapshot an earlier attempt of this save uploaded, so a retry sends
   * the same body under its idempotency key.
   */
  pageSnapshotKey?: string;
  source: SaveSource;
  sourceTitle?: string;
  sourceUrl?: string;
}
export interface SaveToTeakDependencies {
  /** The Teak API to save through; the signed-in user's by default. */
  client?: TeakClient;
  /** Downloads a file to save; the browser's fetch by default. */
  fetchImpl?: typeof fetch;
  onPageSnapshotUploaded?: (pageSnapshotKey: string) => Promise<void>;
  pageSnapshot?: PageSnapshot | null;
}
const isHttpUrl = (value: string) =>
  value.startsWith("http://") || value.startsWith("https://");
const parseContentAsUrl = (content: string): URL | null => {
  // `new URL` encodes spaces and drops newlines, so text that only starts
  // with a link would otherwise save as a broken link.
  if (!isHttpUrl(content) || /\s/.test(content)) {
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

const MAX_SOURCE_URL_LENGTH = 2048;
const MAX_SOURCE_TITLE_LENGTH = 300;

export const textSource = ({
  sourceTitle,
  sourceUrl,
}: Pick<SaveToTeakInput, "sourceTitle" | "sourceUrl">) => {
  const url = sourceUrl?.trim();
  if (!(url && parseContentAsUrl(url)) || url.length > MAX_SOURCE_URL_LENGTH) {
    return {};
  }
  const title = truncateCodePoints(
    sourceTitle?.trim() ?? "",
    MAX_SOURCE_TITLE_LENGTH
  ).trim();
  return title ? { sourceTitle: title, sourceUrl: url } : { sourceUrl: url };
};

/** A failed save as the popup and context menu show it. */
export const saveFailure = (
  error: unknown,
  fallback = "Failed to save content"
): TeakSaveResponse => {
  if (isSignedOut(error)) {
    return { status: "unauthenticated" };
  }
  const failure = inExtensionWords(error);
  return {
    status: "error",
    ...(error instanceof TeakApiError ? { code: error.code } : {}),
    message: failure instanceof Error ? failure.message : fallback,
  };
};

/** A created card as a save result: a link already in Teak is a duplicate. */
export const savedResult = (created: {
  cardId: string;
  resaved?: true;
}): TeakSaveResponse =>
  created.resaved
    ? { status: "duplicate", cardId: created.cardId }
    : { status: "saved", cardId: created.cardId };

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
  const client = dependencies.client ?? teakClient();
  try {
    const content = parsedUrl ? parsedUrl.toString() : input.content;
    let pageSnapshotKey = parsedUrl ? input.pageSnapshotKey : undefined;
    if (parsedUrl && !pageSnapshotKey && dependencies.pageSnapshot) {
      pageSnapshotKey =
        (await uploadPageSnapshot(dependencies.pageSnapshot, { client })) ??
        undefined;
      if (pageSnapshotKey) {
        await dependencies.onPageSnapshotUploaded?.(pageSnapshotKey);
      }
    }
    return savedResult(
      await client.cards.create(
        parsedUrl
          ? { url: content, ...(pageSnapshotKey ? { pageSnapshotKey } : {}) }
          : { content, cardType: "text", ...textSource(input) },
        { idempotencyKey: input.idempotencyKey ?? crypto.randomUUID() }
      )
    );
  } catch (error) {
    return saveFailure(error);
  }
}
