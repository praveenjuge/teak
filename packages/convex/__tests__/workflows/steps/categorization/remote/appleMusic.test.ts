import { describe, expect, test } from "bun:test";
import { buildRawSelectorMap } from "../../../../../workflows/steps/categorization/enrichment";
import { readAppleMusicDetails } from "../../../../../workflows/steps/categorization/remote/appleMusic";
import { richSiteJson } from "../../../../helpers/richSites.test-utils";

const ALBUM = "https://music.apple.com/us/album/example-album/1700000000";
const OG_IMAGE =
  "https://is1-ssl.mzstatic.com/image/thumb/Music/v4/00/00/00/example.jpg/1200x630wp-60.jpg";

const ogImage = (url: string) =>
  buildRawSelectorMap([
    {
      selector: "meta[property='og:image']",
      results: [{ attributes: [{ name: "content", value: url }] }],
    },
  ]);

describe("readAppleMusicDetails", () => {
  test("an album: artist, type and release from its JSON-LD", () => {
    const details = readAppleMusicDetails(ALBUM, ogImage(OG_IMAGE), [
      richSiteJson("apple-music-album.json"),
    ]);

    expect(details).toEqual({
      source: "apple_music",
      facts: [
        { label: "Artist", value: "Example Artist" },
        { label: "Type", value: "Album" },
        { label: "Released", value: "Oct 27, 2023" },
      ],
      imageUrl: OG_IMAGE,
    });
  });

  test("reads an album nested under @graph", () => {
    const details = readAppleMusicDetails(ALBUM, ogImage(OG_IMAGE), [
      { "@graph": [richSiteJson("apple-music-album.json")] },
    ]);

    expect(details?.facts).toContainEqual({
      label: "Artist",
      value: "Example Artist",
    });
  });

  test("an album URL that opens one song is a song", () => {
    const details = readAppleMusicDetails(
      `${ALBUM}?i=1700000001`,
      ogImage(OG_IMAGE),
      [richSiteJson("apple-music-album.json")]
    );

    expect(details?.facts).toContainEqual({ label: "Type", value: "Song" });
  });

  test("without JSON-LD the URL still gives the type and the tag the cover", () => {
    expect(
      readAppleMusicDetails(
        "https://music.apple.com/us/playlist/example/pl.u-abc",
        ogImage(OG_IMAGE),
        []
      )
    ).toEqual({
      source: "apple_music",
      facts: [{ label: "Type", value: "Playlist" }],
      imageUrl: OG_IMAGE,
    });
  });

  test("an image off Apple's hosts falls back to the JSON-LD image", () => {
    const album = richSiteJson("apple-music-album.json");

    const details = readAppleMusicDetails(
      ALBUM,
      ogImage("https://tracker.example/pixel.png"),
      [album]
    );

    expect(details?.imageUrl).toBe(album.image);
  });

  test("nothing to read gives nothing", () => {
    expect(
      readAppleMusicDetails(
        "https://music.apple.com/us/browse",
        buildRawSelectorMap([]),
        []
      )
    ).toBeNull();
  });
});
