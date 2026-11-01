import type { RemoteFetchDeps } from "../categorization/remote/common";
import type { VideoCaptions } from "./types";
import { fetchVimeoCaptions, parseVimeoUrl } from "./vimeo";

// Captions for a video link, as its transcript. Only Vimeo: YouTube's
// caption files need a proof-of-origin token servers don't have, so its
// videos get facts but no transcript (owner decision). Two requests at most,
// each with the lookups' 10 s timeout. Never throws: a miss logs its reason
// and the card goes on without a transcript.

export type { VideoCaptions } from "./types";

export const hasCaptionSource = (url: string | undefined): boolean =>
  Boolean(url && parseVimeoUrl(url));

export const fetchVideoCaptions = async (
  url: string,
  deps: RemoteFetchDeps
): Promise<VideoCaptions | null> => {
  const ref = parseVimeoUrl(url);
  if (!ref) {
    return null;
  }
  try {
    const outcome = await fetchVimeoCaptions(ref, deps);
    if ("captions" in outcome) {
      console.log("[captions] transcript found", {
        auto: outcome.captions.auto,
        language: outcome.captions.language,
        length: outcome.captions.text.length,
        site: "vimeo",
      });
      return outcome.captions;
    }
    console.log("[captions] no transcript", {
      reason: outcome.reason,
      site: "vimeo",
    });
  } catch (error) {
    console.warn("[captions] no transcript", {
      message: error instanceof Error ? error.message : String(error),
      reason: "unreachable",
      site: "vimeo",
    });
  }
  return null;
};
