import type { RemoteLookupInput } from "@teak/convex/shared/linkCategory/remoteDetails";
import { readAppleMusicDetails } from "./appleMusic";
import { fetchArxivDetails } from "./arxiv";
import type { RemoteDetails, RemoteFetchDeps, RemoteSource } from "./common";
import { fetchOpenLibraryDetails, findIsbn } from "./openLibrary";
import { fetchSpotifyDetails } from "./spotify";
import { fetchWikipediaDetails } from "./wikipedia";

export type { RemoteLookupInput } from "@teak/convex/shared/linkCategory/remoteDetails";
export type { RemoteDetails, RemoteFetchDeps, RemoteSource } from "./common";

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
