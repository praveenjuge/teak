import type { LinkCategoryDetail } from "@teak/convex/shared";
import { sanitizeText } from "../../../../linkMetadata/parsing";
import type { SocialFetchDeps } from "../../../../linkMetadata/socialPostHelpers";
import { readBodyWithLimit, safeFetch } from "../../../../linkMetadata/ssrf";

// Site lookups that add facts to a link's category details (Wikipedia,
// arXiv, Spotify, Apple Music, Open Library). Each request goes through
// `safeFetch` (every hop checked against the SSRF policy, connections
// pinned), with a 10 s timeout and a 256 KiB default body cap. A lookup never throws:
// a site that is down, slow or rate-limited leaves the card as it was.

/** The same SSRF-checked transport the social post lookups use. */
export interface RemoteFetchDeps extends SocialFetchDeps {
  /**
   * Asks for one of arXiv's API slots (at most one request every 3 seconds
   * per deployment). False skips the lookup; absent means no throttle.
   */
  takeArxivSlot?: () => Promise<boolean>;
}

export type RemoteSource =
  | "apple_music"
  | "arxiv"
  | "open_library"
  | "spotify"
  | "wikipedia";

/**
 * What a site said about a link. Facts fill gaps in the page's own facts,
 * the image is used only when the page has none, and the summary (an
 * extract or abstract) is input for the AI summary, never shown.
 */
export interface RemoteDetails {
  facts?: LinkCategoryDetail[];
  imageUrl?: string;
  /** arXiv only: the paper's PDF, offered as Save PDF. */
  pdfUrl?: string;
  source: RemoteSource;
  summary?: string;
}

export const REMOTE_FETCH_TIMEOUT_MS = 10_000;
export const REMOTE_MAX_BYTES = 256 * 1024;
/** A long summary is cut here; the AI input is 6,000 characters in all. */
export const REMOTE_SUMMARY_MAX_LENGTH = 4000;
const FACT_VALUE_MAX_LENGTH = 200;
const USER_AGENT = "TeakBot/1.0 (+https://teakvault.com)";

export interface RemoteResponse {
  /** The HTTP status, or 0 when the request never got an answer. */
  status: number;
  /** The body as text; null on any failure, a non-2xx or a body over the cap. */
  text: string | null;
}

/** GET `url` as text. Never throws. */
export const fetchRemoteText = async (
  url: string,
  deps: RemoteFetchDeps,
  {
    accept,
    headers,
    maxBytes = REMOTE_MAX_BYTES,
  }: { accept: string; headers?: Record<string, string>; maxBytes?: number }
): Promise<RemoteResponse> => {
  try {
    const { response } = await safeFetch(
      url,
      deps.resolveDns,
      {
        headers: { ...headers, accept, "user-agent": USER_AGENT },
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

/** GET `url` as JSON; `data` is null on any failure. Never throws. */
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

/** One line of text for a fact, at most 200 characters. */
export const factValue = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number"
    ? sanitizeText(String(value), FACT_VALUE_MAX_LENGTH)
    : undefined;

/** Prose for the AI input, whitespace collapsed and cut at 4,000 characters. */
export const summaryText = (value: unknown): string | undefined =>
  typeof value === "string"
    ? sanitizeText(value, REMOTE_SUMMARY_MAX_LENGTH)
    : undefined;

/** An https URL on `host` (or one of its subdomains), else undefined. */
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
  } catch {}
};

/** "A, B, C et al." for more than three names. */
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

/** JSON-LD nodes, with the ones a page nests under `@graph` brought up. */
export const jsonLdNodes = (entities: unknown[]): unknown[] =>
  entities.flatMap((entity) => {
    const graph = (entity as Record<string, unknown> | null)?.["@graph"];
    return Array.isArray(graph) ? [entity, ...graph] : [entity];
  });
