import {
  getRawAttribute,
  type RawSelectorMap,
} from "../categorization/providers/common";
import {
  fetchRemoteText,
  jsonLdNodes,
  type RemoteFetchDeps,
} from "../categorization/remote/common";
import { type FeedItem, parseFeed } from "./feed";

// Where a podcast episode's audio file is, in order: the page's own
// `og:audio`, its JSON-LD `PodcastEpisode`, Apple's public iTunes lookup for
// an Apple Podcasts link, then the show's feed. Spotify episodes have no
// public audio. Lookups never throw: no audio found means no transcript.

export type EnclosureSource = "og_audio" | "json_ld" | "apple" | "feed";

export interface Enclosure {
  mimeType?: string;
  source: EnclosureSource;
  url: string;
}

export interface EnclosureLookupInput {
  /** The page's JSON-LD: read this run, or stored from an earlier one. */
  entities: unknown[];
  rawMap: RawSelectorMap;
  sourceUrl: string;
  /** The page's title, to find the episode in its show's feed. */
  title?: string;
}

/** A show's feed or iTunes lookup of 200 episodes stays well under this. */
export const PODCAST_LOOKUP_MAX_BYTES = 2 * 1024 * 1024;
const APPLE_HOSTS = new Set(["podcasts.apple.com", "itunes.apple.com"]);
const APPLE_SHOW_PATH_REGEX = /\/podcast\/(?:[^/]+\/)?id(\d{1,15})\/?$/;
const APPLE_EPISODE_ID_REGEX = /^\d{1,20}$/;
const SPOTIFY_HOSTS = new Set(["open.spotify.com", "spotify.com"]);
const FEED_ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml, text/xml";
const EPISODE_TYPES = ["PodcastEpisode"];
const AUDIO_MIME_TYPES = new Map([
  ["aac", "audio/aac"],
  ["m4a", "audio/mp4"],
  ["mp3", "audio/mpeg"],
  ["mp4", "audio/mp4"],
  ["ogg", "audio/ogg"],
  ["opus", "audio/ogg"],
  ["wav", "audio/wav"],
]);

/** `value` as an absolute http(s) URL (relative to `base`), or undefined. */
const httpUrl = (value: unknown, base?: string): string | undefined => {
  if (typeof value !== "string" || !value.trim()) {
    return;
  }
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : undefined;
  } catch {}
};

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {}
};

/** The page's own audio: `og:audio:secure_url`, then `og:audio`. */
export const findPageAudio = (rawMap: RawSelectorMap): Enclosure | null => {
  const url =
    httpUrl(
      getRawAttribute(rawMap, "meta[property='og:audio:secure_url']", "content")
    ) ??
    httpUrl(getRawAttribute(rawMap, "meta[property='og:audio']", "content"));
  if (!url) {
    return null;
  }
  const mimeType = getRawAttribute(
    rawMap,
    "meta[property='og:audio:type']",
    "content"
  );
  return { source: "og_audio", url, ...(mimeType ? { mimeType } : {}) };
};

const typesOf = (node: unknown): string[] =>
  [(node as Record<string, unknown> | null)?.["@type"]]
    .flat()
    .filter((type): type is string => typeof type === "string");

/** A `PodcastEpisode`'s `associatedMedia` or `audio` file, in or under `@graph`. */
export const findJsonLdAudio = (entities: unknown[]): Enclosure | null => {
  for (const node of jsonLdNodes(entities)) {
    if (!typesOf(node).some((type) => EPISODE_TYPES.includes(type))) {
      continue;
    }
    const episode = node as Record<string, unknown>;
    const media = [episode.associatedMedia, episode.audio].flat();
    for (const item of media) {
      const record = item as Record<string, unknown> | null;
      const url = httpUrl(typeof item === "string" ? item : record?.contentUrl);
      if (url) {
        const format = record?.encodingFormat;
        return {
          source: "json_ld",
          url,
          ...(typeof format === "string" && format.includes("/")
            ? { mimeType: format }
            : {}),
        };
      }
    }
  }
  return null;
};

/** An Apple Podcasts episode link's show and episode ids, or null. */
export const parseApplePodcastUrl = (
  url: string
): { episodeId: string; showId: string } | null => {
  try {
    const parsed = new URL(url);
    if (!APPLE_HOSTS.has(parsed.hostname.toLowerCase())) {
      return null;
    }
    const showId = parsed.pathname.match(APPLE_SHOW_PATH_REGEX)?.[1];
    const episodeId = parsed.searchParams.get("i");
    return showId && episodeId && APPLE_EPISODE_ID_REGEX.test(episodeId)
      ? { episodeId, showId }
      : null;
  } catch {
    return null;
  }
};

export const itunesLookupUrl = (showId: string) =>
  `https://itunes.apple.com/lookup?id=${showId}&entity=podcastEpisode&limit=200`;

interface ItunesEpisode {
  episodeContentType?: unknown;
  episodeFileExtension?: unknown;
  episodeUrl?: unknown;
  trackId?: unknown;
  wrapperType?: unknown;
}

/** The episode's audio in an iTunes lookup answer, or null. */
export const findItunesEpisode = (
  lookup: unknown,
  episodeId: string
): Enclosure | null => {
  const results = (lookup as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) {
    return null;
  }
  const episode = results.find(
    (result: ItunesEpisode | null) =>
      result?.wrapperType === "podcastEpisode" &&
      String(result.trackId) === episodeId
  ) as ItunesEpisode | undefined;
  const url = httpUrl(episode?.episodeUrl);
  if (!(episode && url)) {
    return null;
  }
  const extension =
    typeof episode.episodeFileExtension === "string"
      ? episode.episodeFileExtension.toLowerCase()
      : "";
  const isVideo = episode.episodeContentType === "video";
  const mimeType =
    extension === "mp4" && isVideo
      ? "video/mp4"
      : AUDIO_MIME_TYPES.get(extension);
  return { source: "apple", url, ...(mimeType ? { mimeType } : {}) };
};

/** The show's feed the page links to (RSS first, then Atom), or undefined. */
export const findFeedUrl = (
  rawMap: RawSelectorMap,
  sourceUrl: string
): string | undefined =>
  httpUrl(
    getRawAttribute(
      rawMap,
      "link[rel='alternate'][type='application/rss+xml']",
      "href"
    ),
    sourceUrl
  ) ??
  httpUrl(
    getRawAttribute(
      rawMap,
      "link[rel='alternate'][type='application/atom+xml']",
      "href"
    ),
    sourceUrl
  );

/** A URL without its scheme, hash or trailing slash, for comparing links. */
const comparableUrl = (url: string | undefined): string | undefined => {
  if (!url) {
    return;
  }
  try {
    const parsed = new URL(url.trim());
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.hostname.toLowerCase()}${path}${parsed.search}`;
  } catch {}
};

const comparableTitle = (title: string | undefined) =>
  title?.trim().replace(/\s+/g, " ").toLowerCase() || undefined;

/**
 * The feed item for this episode: the same link, then a guid equal to the
 * URL, then the same title. Only an item with an http(s) audio file counts.
 */
export const matchFeedItem = (
  items: FeedItem[],
  { sourceUrl, title }: { sourceUrl: string; title?: string }
): Enclosure | null => {
  const withAudio = items.filter((item) => httpUrl(item.enclosureUrl));
  const page = comparableUrl(sourceUrl);
  const wanted = comparableTitle(title);
  const item =
    (page && withAudio.find((entry) => comparableUrl(entry.link) === page)) ||
    (page && withAudio.find((entry) => comparableUrl(entry.guid) === page)) ||
    (wanted &&
      withAudio.find((entry) => comparableTitle(entry.title) === wanted));
  const url = httpUrl(item ? item.enclosureUrl : undefined);
  if (!(item && url)) {
    return null;
  }
  return {
    source: "feed",
    url,
    ...(item.enclosureType ? { mimeType: item.enclosureType } : {}),
  };
};

const lookUpApple = async (
  sourceUrl: string,
  deps: RemoteFetchDeps
): Promise<Enclosure | null> => {
  const ids = parseApplePodcastUrl(sourceUrl);
  if (!ids) {
    return null;
  }
  const { text } = await fetchRemoteText(itunesLookupUrl(ids.showId), deps, {
    accept: "application/json",
    maxBytes: PODCAST_LOOKUP_MAX_BYTES,
  });
  if (text === null) {
    return null;
  }
  try {
    return findItunesEpisode(JSON.parse(text), ids.episodeId);
  } catch {
    return null;
  }
};

const lookUpFeed = async (
  input: EnclosureLookupInput,
  deps: RemoteFetchDeps
): Promise<Enclosure | null> => {
  const feedUrl = findFeedUrl(input.rawMap, input.sourceUrl);
  if (!feedUrl) {
    return null;
  }
  const { text } = await fetchRemoteText(feedUrl, deps, {
    accept: FEED_ACCEPT,
    maxBytes: PODCAST_LOOKUP_MAX_BYTES,
  });
  if (text === null) {
    return null;
  }
  return matchFeedItem(parseFeed(text), input);
};

/** The episode's audio file, or null when it has none Teak can reach. */
export const resolveEnclosure = async (
  input: EnclosureLookupInput,
  deps: RemoteFetchDeps
): Promise<Enclosure | null> => {
  try {
    const host = hostOf(input.sourceUrl);
    if (!host || SPOTIFY_HOSTS.has(host)) {
      return null;
    }
    return (
      findPageAudio(input.rawMap) ??
      findJsonLdAudio(input.entities) ??
      (await lookUpApple(input.sourceUrl, deps)) ??
      (await lookUpFeed(input, deps))
    );
  } catch (error) {
    console.warn("[podcast] Audio lookup failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};
