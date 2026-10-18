import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildRawSelectorMap } from "../../../../workflows/steps/categorization/enrichment";
import { parseFeed } from "../../../../workflows/steps/podcast/feed";
import {
  findFeedUrl,
  findJsonLdAudio,
  findPageAudio,
  itunesLookupUrl,
  matchFeedItem,
  PODCAST_LOOKUP_MAX_BYTES,
  parseApplePodcastUrl,
  resolveEnclosure,
} from "../../../../workflows/steps/podcast/resolveEnclosure";
import {
  jsonResponse,
  socialFetch,
} from "../../../helpers/socialFetch.test-utils";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

const EPISODE = "https://podcast.example.com/episodes/2";
const FEED = "https://podcast.example.com/feed.xml";
const AUDIO = "https://cdn.example.com/audio/episode-2.mp3";
const APPLE =
  "https://podcasts.apple.com/us/podcast/example-show/id1500000000?i=1000700000001";

const tag = (selector: string, name: string, value: string) => ({
  selector,
  results: [{ attributes: [{ name, value }] }],
});
const ogAudio = (url: string) =>
  tag("meta[property='og:audio']", "content", url);
const rssLink = (href: string) =>
  tag("link[rel='alternate'][type='application/rss+xml']", "href", href);
const atomLink = (href: string) =>
  tag("link[rel='alternate'][type='application/atom+xml']", "href", href);

const input = (
  sourceUrl: string,
  {
    entities = [],
    raw = [],
    title,
  }: {
    entities?: unknown[];
    raw?: ReturnType<typeof tag>[];
    title?: string;
  } = {}
) => ({ entities, rawMap: buildRawSelectorMap(raw), sourceUrl, title });

const xml = (body: string, init?: ResponseInit) =>
  new Response(body, {
    status: 200,
    ...init,
    headers: { "content-type": "application/rss+xml" },
  });

const episodeJsonLd = (media: unknown) => ({
  "@type": "PodcastEpisode",
  associatedMedia: media,
});

describe("finding audio on the page", () => {
  test("og:audio:secure_url wins over og:audio, with its type", () => {
    const rawMap = buildRawSelectorMap([
      ogAudio("http://cdn.example.com/plain.mp3"),
      tag(
        "meta[property='og:audio:secure_url']",
        "content",
        "https://cdn.example.com/secure.mp3"
      ),
      tag("meta[property='og:audio:type']", "content", "audio/mpeg"),
    ]);

    expect(findPageAudio(rawMap)).toEqual({
      mimeType: "audio/mpeg",
      source: "og_audio",
      url: "https://cdn.example.com/secure.mp3",
    });
  });

  test.each([
    "javascript:alert(1)",
    "ftp://cdn.example.com/a.mp3",
    "/relative.mp3",
    "",
  ])("og:audio %p is refused", (url) => {
    expect(findPageAudio(buildRawSelectorMap([ogAudio(url)]))).toBeNull();
  });

  test("reads a PodcastEpisode's media, also under @graph", () => {
    expect(
      findJsonLdAudio([
        episodeJsonLd({
          "@type": "MediaObject",
          contentUrl: "https://cdn.example.com/a.m4a",
          encodingFormat: "audio/mp4",
        }),
      ])
    ).toEqual({
      mimeType: "audio/mp4",
      source: "json_ld",
      url: "https://cdn.example.com/a.m4a",
    });
    expect(
      findJsonLdAudio([
        {
          "@graph": [
            { "@type": "WebPage" },
            {
              "@type": "PodcastEpisode",
              audio: [{ contentUrl: "https://cdn.example.com/b.mp3" }],
            },
          ],
        },
      ])
    ).toEqual({ source: "json_ld", url: "https://cdn.example.com/b.mp3" });
  });

  test("a series or an episode without a usable file gives nothing", () => {
    expect(
      findJsonLdAudio([
        {
          "@type": "PodcastSeries",
          associatedMedia: { contentUrl: "https://cdn.example.com/a.mp3" },
        },
        episodeJsonLd({ contentUrl: "data:audio/mpeg;base64,AAAA" }),
      ])
    ).toBeNull();
  });
});

describe("Apple Podcasts", () => {
  test.each([
    [APPLE, { episodeId: "1000700000001", showId: "1500000000" }],
    [
      "https://podcasts.apple.com/podcast/id1500000000?i=1000700000001",
      { episodeId: "1000700000001", showId: "1500000000" },
    ],
  ])("reads %s", (url, ids) => {
    expect(parseApplePodcastUrl(url)).toEqual(ids);
  });

  test.each([
    "https://podcasts.apple.com/us/podcast/example-show/id1500000000",
    "https://podcasts.apple.com/us/podcast/example-show/id1500000000?i=abc",
    "https://podcasts.apple.com.example.com/us/podcast/x/id1?i=2",
    "https://example.com/us/podcast/x/id1?i=2",
  ])("ignores %s", (url) => {
    expect(parseApplePodcastUrl(url)).toBeNull();
  });

  test("finds the episode in the iTunes lookup", async () => {
    const lookup = itunesLookupUrl("1500000000");
    const { deps, requests } = socialFetch((url) =>
      url === lookup
        ? jsonResponse(JSON.parse(fixture("itunes-lookup.json")))
        : undefined
    );

    expect(await resolveEnclosure(input(APPLE), deps)).toEqual({
      mimeType: "audio/mpeg",
      source: "apple",
      url: AUDIO,
    });
    expect(requests).toEqual([lookup]);
  });

  test("a video episode is video/mp4", async () => {
    const { deps } = socialFetch(() =>
      jsonResponse(JSON.parse(fixture("itunes-lookup.json")))
    );

    expect(
      await resolveEnclosure(
        input(APPLE.replace("1000700000001", "1000700000002")),
        deps
      )
    ).toMatchObject({ mimeType: "video/mp4", source: "apple" });
  });

  test("an episode the lookup doesn't list gives nothing", async () => {
    const { deps } = socialFetch(() =>
      jsonResponse(JSON.parse(fixture("itunes-lookup.json")))
    );

    expect(
      await resolveEnclosure(
        input(APPLE.replace("1000700000001", "1000700000009")),
        deps
      )
    ).toBeNull();
  });
});

describe("the show's feed", () => {
  test("finds the RSS feed first, relative to the page", () => {
    const rawMap = buildRawSelectorMap([
      atomLink("https://podcast.example.com/atom.xml"),
      rssLink("/feed.xml"),
    ]);

    expect(findFeedUrl(rawMap, EPISODE)).toBe(FEED);
    expect(
      findFeedUrl(
        buildRawSelectorMap([rssLink("javascript:alert(1)")]),
        EPISODE
      )
    ).toBeUndefined();
  });

  test("matches by link, then guid, then title", () => {
    const items = parseFeed(fixture("rss.xml"));

    expect(
      matchFeedItem(items, {
        sourceUrl: "http://PODCAST.example.com/episodes/2/#t=30",
      })
    ).toEqual({ mimeType: "audio/mpeg", source: "feed", url: AUDIO });
    expect(
      matchFeedItem(items, { sourceUrl: "https://podcast.example.com/e/1" })
    ).toMatchObject({ url: "https://cdn.example.com/audio/episode-1.m4a" });
    expect(
      matchFeedItem(items, {
        sourceUrl: "https://elsewhere.example.com/show/rivers",
        title: "  episode 1:  RIVERS ",
      })
    ).toMatchObject({ url: "https://cdn.example.com/audio/episode-1.m4a" });
  });

  test("an item without audio, or nothing that matches, gives nothing", () => {
    const items = parseFeed(fixture("rss.xml"));

    expect(
      matchFeedItem(items, {
        sourceUrl: "https://podcast.example.com/episodes/trailer",
      })
    ).toBeNull();
    expect(
      matchFeedItem(items, {
        sourceUrl: "https://podcast.example.com/episodes/99",
        title: "Not an episode",
      })
    ).toBeNull();
  });

  test("matches an Atom entry's enclosure link", async () => {
    const atom = "https://atom.example.com/feed.atom";
    const { deps } = socialFetch((url) =>
      url === atom ? xml(fixture("atom.xml")) : undefined
    );

    expect(
      await resolveEnclosure(
        input("https://atom.example.com/mountains", { raw: [atomLink(atom)] }),
        deps
      )
    ).toEqual({
      mimeType: "audio/mpeg",
      source: "feed",
      url: "https://cdn.example.com/atom/mountains.mp3",
    });
  });

  test("an episode page with only a feed link resolves through the feed", async () => {
    const { deps, requests } = socialFetch((url) =>
      url === FEED ? xml(fixture("rss.xml")) : undefined
    );

    expect(
      await resolveEnclosure(input(EPISODE, { raw: [rssLink(FEED)] }), deps)
    ).toEqual({ mimeType: "audio/mpeg", source: "feed", url: AUDIO });
    expect(requests).toEqual([FEED]);
  });

  test.each([
    ["a feed that answers 404", () => new Response("gone", { status: 404 })],
    [
      "a feed over 2 MiB",
      () => xml(`<rss>${" ".repeat(PODCAST_LOOKUP_MAX_BYTES + 1)}</rss>`),
    ],
    ["a feed that isn't XML", () => xml("<html><body>hi")],
  ])("%s gives nothing", async (_name, respond) => {
    const { deps } = socialFetch(() => respond());

    expect(
      await resolveEnclosure(input(EPISODE, { raw: [rssLink(FEED)] }), deps)
    ).toBeNull();
  });
});

describe("resolveEnclosure", () => {
  test("the page's own audio wins and nothing is fetched", async () => {
    const { deps, requests } = socialFetch(() => undefined);

    const found = await resolveEnclosure(
      input(EPISODE, {
        entities: [
          episodeJsonLd({ contentUrl: "https://cdn.example.com/ld.mp3" }),
        ],
        raw: [ogAudio("https://cdn.example.com/og.mp3"), rssLink(FEED)],
      }),
      deps
    );

    expect(found).toMatchObject({ source: "og_audio" });
    expect(requests).toEqual([]);
  });

  test("JSON-LD comes before the feed", async () => {
    const { deps, requests } = socialFetch(() => undefined);

    expect(
      await resolveEnclosure(
        input(EPISODE, {
          entities: [
            episodeJsonLd({ contentUrl: "https://cdn.example.com/ld.mp3" }),
          ],
          raw: [rssLink(FEED)],
        }),
        deps
      )
    ).toMatchObject({ source: "json_ld" });
    expect(requests).toEqual([]);
  });

  test("a Spotify episode has no public audio and asks nothing", async () => {
    const { deps, requests } = socialFetch(() => undefined);

    expect(
      await resolveEnclosure(
        input("https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ", {
          raw: [ogAudio("https://cdn.example.com/og.mp3"), rssLink(FEED)],
        }),
        deps
      )
    ).toBeNull();
    expect(requests).toEqual([]);
  });

  test("a page with no audio hints asks nothing", async () => {
    const { deps, requests } = socialFetch(() => undefined);

    expect(await resolveEnclosure(input(EPISODE), deps)).toBeNull();
    expect(requests).toEqual([]);
  });

  test("a feed link to a private address is refused", async () => {
    const { deps, requests } = socialFetch(() => xml(fixture("rss.xml")), {
      addresses: ["10.0.0.5"],
    });

    expect(
      await resolveEnclosure(input(EPISODE, { raw: [rssLink(FEED)] }), deps)
    ).toBeNull();
    expect(requests).toEqual([]);
  });
});
