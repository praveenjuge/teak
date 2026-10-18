import { formatDate } from "../providers/common";
import {
  buildFacts,
  factValue,
  fetchRemoteJson,
  httpsUrlOn,
  type RemoteDetails,
  type RemoteFetchDeps,
  summaryText,
} from "./common";

// A Wikipedia article's short description, lead image and last edit, from
// the page summary API. The lead extract feeds the AI summary.

const WIKIPEDIA_HOST_REGEX = /^([a-z][a-z0-9-]{1,15})(?:\.m)?\.wikipedia\.org$/;
const DOTS_ONLY_REGEX = /^\.+$/;

interface WikipediaSummary {
  description?: string;
  extract?: string;
  originalimage?: { source?: string };
  thumbnail?: { source?: string };
  timestamp?: string;
  type?: string;
}

export interface WikipediaPageRef {
  lang: string;
  /** The title as the URL names it, decoded, spaces as underscores. */
  title: string;
}

/** `https://<lang>.wikipedia.org/wiki/<title>`, mobile pages included. */
export const parseWikipediaUrl = (url: string): WikipediaPageRef | null => {
  try {
    const parsed = new URL(url);
    const lang = parsed.hostname.toLowerCase().match(WIKIPEDIA_HOST_REGEX)?.[1];
    if (
      !lang ||
      parsed.protocol !== "https:" ||
      !parsed.pathname.startsWith("/wiki/")
    ) {
      return null;
    }
    const title = decodeURIComponent(parsed.pathname.slice("/wiki/".length))
      .trim()
      .replace(/ /g, "_");
    // `.` and `..` would resolve as path segments of the API URL.
    if (!title || DOTS_ONLY_REGEX.test(title)) {
      return null;
    }
    return { lang, title };
  } catch {
    return null;
  }
};

/** The summary API URL; the title is one encoded path segment. */
export const wikipediaSummaryUrl = ({ lang, title }: WikipediaPageRef) =>
  `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

export const readWikipediaSummary = (
  summary: WikipediaSummary
): RemoteDetails | null => {
  if (!summary || typeof summary !== "object") {
    return null;
  }
  const disambiguation = summary.type === "disambiguation";
  const details: RemoteDetails = {
    source: "wikipedia",
    facts: buildFacts([
      ["About", disambiguation ? undefined : factValue(summary.description)],
      ["Page", disambiguation ? "Disambiguation" : undefined],
      [
        "Updated",
        typeof summary.timestamp === "string"
          ? formatDate(summary.timestamp)
          : undefined,
      ],
    ]),
    summary: summaryText(summary.extract),
  };
  // A disambiguation page lists other pages; it has no picture of its own.
  const imageUrl = disambiguation
    ? undefined
    : (httpsUrlOn(summary.originalimage?.source, "wikimedia.org") ??
      httpsUrlOn(summary.thumbnail?.source, "wikimedia.org"));
  if (imageUrl) {
    details.imageUrl = imageUrl;
  }
  return details.facts || details.summary || details.imageUrl ? details : null;
};

export const fetchWikipediaDetails = async (
  sourceUrl: string,
  deps: RemoteFetchDeps
): Promise<RemoteDetails | null> => {
  const page = parseWikipediaUrl(sourceUrl);
  if (!page) {
    return null;
  }
  const { data } = await fetchRemoteJson<WikipediaSummary>(
    wikipediaSummaryUrl(page),
    deps
  );
  return data ? readWikipediaSummary(data) : null;
};
