import { describe, expect, test } from "bun:test";
import { buildRawSelectorMap } from "../../../../../workflows/steps/categorization/enrichment";
import {
  fetchSpotifyDetails,
  parseSpotifyUrl,
} from "../../../../../workflows/steps/categorization/remote/spotify";
import { richSiteJson } from "../../../../helpers/richSites.test-utils";
import {
  jsonResponse,
  socialFetch,
} from "../../../../helpers/socialFetch.test-utils";

const oembedUrl = (page: string) =>
  `https://open.spotify.com/oembed?url=${encodeURIComponent(page)}`;

const tags = (entries: Record<string, string>) =>
  buildRawSelectorMap(
    Object.entries(entries).map(([selector, content]) => ({
      selector,
      results: [{ attributes: [{ name: "content", value: content }] }],
    }))
  );

const TRACK = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC";
const ALBUM = "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3";
const PLAYLIST = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";

describe("parseSpotifyUrl", () => {
  test.each([
    [TRACK, "track", TRACK],
    [`${ALBUM}?si=abc`, "album", ALBUM],
    [
      "https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC",
      "track",
      TRACK,
    ],
    [
      "https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ",
      "episode",
      "https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ",
    ],
  ])("reads %s", (url: string, kind: string, page: string) => {
    expect(parseSpotifyUrl(url)).toMatchObject({ kind, url: page });
  });

  test.each([
    "https://open.spotify.com/",
    "https://open.spotify.com/search/rick",
    "https://open.spotify.com/track/short",
    "https://spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC/../../oembed",
  ])("ignores %s", (url: string) => {
    expect(parseSpotifyUrl(url)).toBeNull();
  });
});

describe("fetchSpotifyDetails", () => {
  test("a track: artist from its tag, cover from oEmbed", async () => {
    const fixture = richSiteJson("spotify-track.json");
    const { deps, requests } = socialFetch((url) =>
      url === oembedUrl(TRACK) ? jsonResponse(fixture) : undefined
    );

    const details = await fetchSpotifyDetails(
      `${TRACK}?si=share`,
      tags({ "meta[name='music:musician_description']": "Rick Astley" }),
      deps
    );

    expect(requests).toEqual([oembedUrl(TRACK)]);
    expect(details).toEqual({
      source: "spotify",
      facts: [
        { label: "Artist", value: "Rick Astley" },
        { label: "Type", value: "Track" },
      ],
      imageUrl: fixture.thumbnail_url,
    });
  });

  test("an album: artist from the description", async () => {
    const { deps } = socialFetch(() =>
      jsonResponse(richSiteJson("spotify-album.json"))
    );

    const details = await fetchSpotifyDetails(
      ALBUM,
      tags({
        "meta[property='og:description']":
          "Carly Rae Jepsen · album · 2015 · 15 songs",
      }),
      deps
    );

    expect(details?.facts).toEqual([
      { label: "Artist", value: "Carly Rae Jepsen" },
      { label: "Type", value: "Album" },
    ]);
  });

  test("a playlist names no artist", async () => {
    const { deps } = socialFetch(() =>
      jsonResponse(richSiteJson("spotify-playlist.json"))
    );

    const details = await fetchSpotifyDetails(
      PLAYLIST,
      tags({
        "meta[property='og:description']": "Playlist · Spotify · 50 items",
      }),
      deps
    );

    expect(details?.facts).toEqual([{ label: "Type", value: "Playlist" }]);
  });

  test("a region-locked track still gets its artist and type", async () => {
    const { deps } = socialFetch(
      () => new Response("Not found", { status: 404 })
    );

    const details = await fetchSpotifyDetails(
      TRACK,
      tags({ "meta[name='music:musician_description']": "Rick Astley" }),
      deps
    );

    expect(details).toEqual({
      source: "spotify",
      facts: [
        { label: "Artist", value: "Rick Astley" },
        { label: "Type", value: "Track" },
      ],
    });
  });

  test("nothing from Spotify or the page gives nothing", async () => {
    const { deps } = socialFetch(() => new Response("", { status: 500 }));

    expect(await fetchSpotifyDetails(TRACK, tags({}), deps)).toBeNull();
  });

  test("a cover off Spotify's image hosts is dropped", async () => {
    const { deps } = socialFetch(() =>
      jsonResponse({ thumbnail_url: "https://tracker.example/pixel.png" })
    );

    const details = await fetchSpotifyDetails(TRACK, tags({}), deps);

    expect(details?.imageUrl).toBeUndefined();
  });
});
