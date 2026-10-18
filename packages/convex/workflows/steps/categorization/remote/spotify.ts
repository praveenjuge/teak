import { getRawAttribute, type RawSelectorMap } from "../providers/common";
import {
  buildFacts,
  factValue,
  fetchRemoteJson,
  httpsUrlOn,
  type RemoteDetails,
  type RemoteFetchDeps,
} from "./common";

// A Spotify link's cover art and type from Spotify's oEmbed, and its artist
// from the page's own tags (oEmbed has no artist field).

const SPOTIFY_PATH_REGEX =
  /^(?:\/intl-[a-z-]+)?\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,40})\/?$/i;
const DESCRIPTION_SEPARATOR = " · ";

const TYPE_LABELS: Record<string, string> = {
  album: "Album",
  artist: "Artist",
  episode: "Episode",
  playlist: "Playlist",
  show: "Show",
  track: "Track",
};

interface SpotifyOEmbed {
  thumbnail_url?: string;
  title?: string;
}

export interface SpotifyRef {
  id: string;
  kind: string;
  /** The page without its locale prefix or query, as oEmbed expects it. */
  url: string;
}

export const parseSpotifyUrl = (url: string): SpotifyRef | null => {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname.toLowerCase() !== "open.spotify.com"
    ) {
      return null;
    }
    const match = parsed.pathname.match(SPOTIFY_PATH_REGEX);
    if (!(match?.[1] && match[2])) {
      return null;
    }
    const kind = match[1].toLowerCase();
    return {
      id: match[2],
      kind,
      url: `https://open.spotify.com/${kind}/${match[2]}`,
    };
  } catch {
    return null;
  }
};

/**
 * The artist from `music:musician_description`, else the first part of a
 * track or album's description ("Artist · Album · Song · 1987").
 */
export const spotifyArtist = (
  kind: string,
  rawMap: RawSelectorMap
): string | undefined => {
  const musician = getRawAttribute(
    rawMap,
    "meta[name='music:musician_description']",
    "content"
  );
  if (musician) {
    return musician;
  }
  if (kind !== "track" && kind !== "album") {
    return;
  }
  const description =
    getRawAttribute(rawMap, "meta[property='og:description']", "content") ??
    getRawAttribute(rawMap, "meta[name='og:description']", "content");
  const parts = description?.split(DESCRIPTION_SEPARATOR) ?? [];
  const first = parts[0]?.trim();
  // "Album · 2015 · 15 songs" starts with the type, not a name.
  return parts.length >= 3 &&
    first &&
    first.toLowerCase() !== kind &&
    first.toLowerCase() !== "album"
    ? first
    : undefined;
};

export const fetchSpotifyDetails = async (
  sourceUrl: string,
  rawMap: RawSelectorMap,
  deps: RemoteFetchDeps
): Promise<RemoteDetails | null> => {
  const ref = parseSpotifyUrl(sourceUrl);
  if (!ref) {
    return null;
  }
  const { data } = await fetchRemoteJson<SpotifyOEmbed>(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(ref.url)}`,
    deps
  );
  const artist = factValue(spotifyArtist(ref.kind, rawMap));
  const details: RemoteDetails = {
    source: "spotify",
    facts: buildFacts([
      ["Artist", artist],
      ["Type", TYPE_LABELS[ref.kind]],
    ]),
  };
  const imageUrl =
    httpsUrlOn(data?.thumbnail_url, "spotifycdn.com") ??
    httpsUrlOn(data?.thumbnail_url, "scdn.co");
  if (imageUrl) {
    details.imageUrl = imageUrl;
  }
  // Without an answer from Spotify, the type alone is kept only beside an
  // artist the page named.
  return data || artist ? details : null;
};
