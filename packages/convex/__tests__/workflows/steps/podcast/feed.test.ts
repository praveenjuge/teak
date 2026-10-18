import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  MAX_FEED_ITEMS,
  parseFeed,
} from "../../../../workflows/steps/podcast/feed";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

describe("parseFeed", () => {
  test("reads an RSS 2.0 item's title, link, guid and enclosure", () => {
    const items = parseFeed(fixture("rss.xml"));

    expect(items).toEqual([
      {
        enclosureLength: 20_971_520,
        enclosureType: "audio/mpeg",
        enclosureUrl: "https://cdn.example.com/audio/episode-2.mp3",
        guid: "example-show-2",
        link: "https://podcast.example.com/episodes/2",
        title: "Episode 2: Tides & Moons",
      },
      {
        enclosureLength: 1_048_576,
        enclosureType: "audio/x-m4a",
        enclosureUrl: "https://cdn.example.com/audio/episode-1.m4a",
        guid: "https://podcast.example.com/e/1",
        title: "Episode 1: Rivers",
      },
      {
        link: "https://podcast.example.com/episodes/trailer",
        title: "Bonus: Trailer",
      },
    ]);
  });

  test("reads an Atom entry's alternate link and enclosure link", () => {
    const items = parseFeed(fixture("atom.xml"));

    expect(items).toEqual([
      {
        enclosureLength: 5_242_880,
        enclosureType: "audio/mpeg",
        enclosureUrl: "https://cdn.example.com/atom/mountains.mp3",
        guid: "tag:atom.example.com,2026:mountains",
        link: "https://atom.example.com/mountains/",
        title: "Mountains",
      },
      {
        enclosureType: "audio/mpeg",
        enclosureUrl: "https://cdn.example.com/atom/valleys.mp3",
        guid: "tag:atom.example.com,2026:valleys",
        link: "https://atom.example.com/valleys",
        title: "Valleys",
      },
    ]);
  });

  test("an Atom XHTML title keeps the text of its markup", () => {
    const [entry] = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">Episode <b>7</b>: owls</div></title>
        <id>urn:episode:7</id>
      </entry>
    </feed>`);
    expect(entry).toEqual({ guid: "urn:episode:7", title: "Episode 7: owls" });
  });

  test("the channel's own title and link aren't an item's", () => {
    const items = parseFeed(
      "<rss><channel><title>Show</title><link>https://x.example.com/</link></channel></rss>"
    );

    expect(items).toEqual([]);
  });

  test(`stops at ${MAX_FEED_ITEMS} items`, () => {
    const item = (index: number) =>
      `<item><title>Episode ${index}</title><enclosure url="https://cdn.example.com/${index}.mp3"/></item>`;
    const xml = `<rss><channel>${Array.from(
      { length: MAX_FEED_ITEMS + 10 },
      (_, index) => item(index)
    ).join("")}</channel></rss>`;

    const items = parseFeed(xml);

    expect(items).toHaveLength(MAX_FEED_ITEMS);
    expect(items.at(-1)?.title).toBe(`Episode ${MAX_FEED_ITEMS - 1}`);
  });

  test("malformed XML gives what it read and never throws", () => {
    expect(
      parseFeed(
        "<rss><channel><item><title>Half</title><enclosure url='https://cdn.example.com/a.mp3'"
      )
    ).toEqual([{ title: "Half" }]);
    expect(parseFeed("not xml at all")).toEqual([]);
  });
});
