import type { LinkCategory, LinkCategoryDetail } from "@teak/convex/shared";
import type { RawSelectorMap } from "../providers/common";
import { readAppleMusicDetails } from "./appleMusic";
import { fetchArxivDetails } from "./arxiv";
import type { RemoteDetails, RemoteFetchDeps, RemoteSource } from "./common";
import { fetchOpenLibraryDetails, findIsbn } from "./openLibrary";
import { fetchSpotifyDetails } from "./spotify";
import { fetchWikipediaDetails } from "./wikipedia";

export type { RemoteDetails, RemoteFetchDeps, RemoteSource } from "./common";

export const MAX_LINK_FACTS = 8;

const FACT_LABEL_ALIASES: Record<string, string[]> = {
  Pages: ["Length"],
  Released: ["Release", "Published"],
};

export interface RemoteLookupInput {
  category: LinkCategory;
  entities: unknown[];
  provider?: string;
  rawMap: RawSelectorMap;
  sourceUrl: string;
}

export const remoteSourceFor = (
  input: RemoteLookupInput
): RemoteSource | null => {
  switch (input.provider) {
    case "wikipedia":
      return "wikipedia";
    case "arxiv":
      return "arxiv";
    case "spotify":
      return "spotify";
    case "apple":
      if (input.category === "music") {
        return "apple_music";
      }
      break;
    // Amazon files books under products; an ISBN in the link marks a book.
    case "amazon":
      return findIsbn(input) ? "open_library" : null;
    default:
      break;
  }
  return input.category === "book" && findIsbn(input) ? "open_library" : null;
};

export const fetchRemoteDetails = async (
  input: RemoteLookupInput,
  deps: RemoteFetchDeps
): Promise<RemoteDetails | null> => {
  try {
    switch (remoteSourceFor(input)) {
      case "wikipedia":
        return await fetchWikipediaDetails(input.sourceUrl, deps);
      case "arxiv":
        return await fetchArxivDetails(input.sourceUrl, deps);
      case "spotify":
        return await fetchSpotifyDetails(input.sourceUrl, input.rawMap, deps);
      case "apple_music":
        return readAppleMusicDetails(
          input.sourceUrl,
          input.rawMap,
          input.entities
        );
      case "open_library": {
        const isbn = findIsbn(input);
        return isbn ? await fetchOpenLibraryDetails(isbn, deps) : null;
      }
      default:
        return null;
    }
  } catch (error) {
    console.warn("[categorization] Site details unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

export const fillFacts = (
  target: LinkCategoryDetail[],
  incoming: LinkCategoryDetail[] | undefined
) => {
  const labels = new Set(target.map((fact) => fact.label.toLowerCase()));
  for (const fact of incoming ?? []) {
    if (target.length >= MAX_LINK_FACTS) {
      return;
    }
    const names = [fact.label, ...(FACT_LABEL_ALIASES[fact.label] ?? [])];
    if (names.some((name) => labels.has(name.toLowerCase()))) {
      continue;
    }
    target.push(fact);
    labels.add(fact.label.toLowerCase());
  }
};
