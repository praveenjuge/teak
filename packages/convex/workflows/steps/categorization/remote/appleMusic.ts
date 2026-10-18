import {
  formatDate,
  getRawAttribute,
  type RawSelectorMap,
} from "../providers/common";
import {
  buildFacts,
  factValue,
  formatAuthors,
  httpsUrlOn,
  jsonLdNodes,
  type RemoteDetails,
} from "./common";

// An Apple Music link's artist, type and release date from the page's own
// JSON-LD, and its cover from Open Graph. Apple Music has no public oEmbed,
// so nothing is fetched.

const MUSIC_TYPES = ["MusicAlbum", "MusicRecording", "MusicPlaylist"];
const PATH_TYPES: [RegExp, string][] = [
  [/^\/[a-z]{2}\/song\//i, "Song"],
  [/^\/[a-z]{2}\/album\//i, "Album"],
  [/^\/[a-z]{2}\/playlist\//i, "Playlist"],
  [/^\/[a-z]{2}\/music-video\//i, "Music video"],
  [/^\/[a-z]{2}\/artist\//i, "Artist"],
];
const SCHEMA_TYPE_LABELS: Record<string, string> = {
  MusicAlbum: "Album",
  MusicPlaylist: "Playlist",
  MusicRecording: "Song",
};

const typesOf = (entity: any): string[] =>
  [entity?.["@type"]].flat().filter((type) => typeof type === "string");

const names = (value: unknown): string[] =>
  [value]
    .flat()
    .map((item) =>
      typeof item === "string" ? item : (item as { name?: unknown })?.name
    )
    .filter((name): name is string => typeof name === "string");

/** What the URL is: an album URL with `?i=` opens one of its songs. */
const typeFromUrl = (sourceUrl: string): string | undefined => {
  try {
    const url = new URL(sourceUrl);
    if (url.searchParams.has("i") && /\/album\//i.test(url.pathname)) {
      return "Song";
    }
    return PATH_TYPES.find(([regex]) => regex.test(url.pathname))?.[1];
  } catch {}
};

export const readAppleMusicDetails = (
  sourceUrl: string,
  rawMap: RawSelectorMap,
  entities: unknown[]
): RemoteDetails | null => {
  const music = jsonLdNodes(entities).find((entity) =>
    typesOf(entity).some((type) => MUSIC_TYPES.includes(type))
  ) as Record<string, unknown> | undefined;
  const schemaType = music
    ? typesOf(music).find((type) => SCHEMA_TYPE_LABELS[type])
    : undefined;
  const details: RemoteDetails = {
    source: "apple_music",
    facts: buildFacts([
      [
        "Artist",
        factValue(formatAuthors(names(music?.byArtist ?? music?.creator))),
      ],
      [
        "Type",
        typeFromUrl(sourceUrl) ??
          (schemaType ? SCHEMA_TYPE_LABELS[schemaType] : undefined),
      ],
      [
        "Released",
        typeof music?.datePublished === "string"
          ? formatDate(music.datePublished)
          : undefined,
      ],
    ]),
  };
  const imageUrl =
    httpsUrlOn(
      getRawAttribute(rawMap, "meta[property='og:image']", "content"),
      "mzstatic.com"
    ) ?? httpsUrlOn(music?.image, "mzstatic.com");
  if (imageUrl) {
    details.imageUrl = imageUrl;
  }
  return details.facts || details.imageUrl ? details : null;
};
