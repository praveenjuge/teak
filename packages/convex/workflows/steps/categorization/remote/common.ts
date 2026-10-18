import type { LinkCategoryDetail } from "@teak/convex/shared";
import { sanitizeText } from "../../../../linkMetadata/parsing";
import type { SocialFetchDeps } from "../../../../linkMetadata/socialPostHelpers";
import { readBodyWithLimit, safeFetch } from "../../../../linkMetadata/ssrf";

export interface RemoteFetchDeps extends SocialFetchDeps {
  takeArxivSlot?: () => Promise<boolean>;
}

export type RemoteSource =
  | "apple_music"
  | "arxiv"
  | "open_library"
  | "spotify"
  | "wikipedia";

export interface RemoteDetails {
  facts?: LinkCategoryDetail[];
  imageUrl?: string;
  pdfUrl?: string;
  source: RemoteSource;
  summary?: string;
}

export const REMOTE_FETCH_TIMEOUT_MS = 10_000;
export const REMOTE_MAX_BYTES = 256 * 1024;
export const REMOTE_SUMMARY_MAX_LENGTH = 4000;
const FACT_VALUE_MAX_LENGTH = 200;
const USER_AGENT = "TeakBot/1.0 (+https://teakvault.com)";

export interface RemoteResponse {
  status: number;
  text: string | null;
}

export const fetchRemoteText = async (
  url: string,
  deps: RemoteFetchDeps,
  { accept, maxBytes = REMOTE_MAX_BYTES }: { accept: string; maxBytes?: number }
): Promise<RemoteResponse> => {
  try {
    const { response } = await safeFetch(
      url,
      deps.resolveDns,
      {
        headers: { accept, "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(deps.timeoutMs ?? REMOTE_FETCH_TIMEOUT_MS),
      },
      deps.pinnedFetch
    );
    const declaredLength = Number(response.headers.get("content-length"));
    if (!response.ok || declaredLength > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status, text: null };
    }
    const body = await readBodyWithLimit(response, maxBytes);
    return {
      status: response.status,
      text: new TextDecoder().decode(body),
    };
  } catch (error) {
    console.warn("[categorization] Site lookup failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { status: 0, text: null };
  }
};

export const fetchRemoteJson = async <T>(
  url: string,
  deps: RemoteFetchDeps
): Promise<{ data: T | null; status: number }> => {
  const { status, text } = await fetchRemoteText(url, deps, {
    accept: "application/json",
  });
  if (text === null) {
    return { data: null, status };
  }
  try {
    return { data: JSON.parse(text) as T, status };
  } catch {
    return { data: null, status };
  }
};

export const factValue = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number"
    ? sanitizeText(String(value), FACT_VALUE_MAX_LENGTH)
    : undefined;

export const summaryText = (value: unknown): string | undefined =>
  typeof value === "string"
    ? sanitizeText(value, REMOTE_SUMMARY_MAX_LENGTH)
    : undefined;

export const httpsUrlOn = (
  value: unknown,
  host: string
): string | undefined => {
  if (typeof value !== "string") {
    return;
  }
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      (hostname === host || hostname.endsWith(`.${host}`))
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

export const formatAuthors = (names: string[]): string | undefined => {
  const kept = names.map((name) => name.trim()).filter(Boolean);
  if (kept.length === 0) {
    return;
  }
  return kept.length > 3
    ? `${kept.slice(0, 3).join(", ")} et al.`
    : kept.join(", ");
};

export const buildFacts = (
  entries: [label: string, value: string | undefined][]
): LinkCategoryDetail[] | undefined => {
  const facts = entries.flatMap(([label, value]) =>
    value ? [{ label, value }] : []
  );
  return facts.length > 0 ? facts : undefined;
};
