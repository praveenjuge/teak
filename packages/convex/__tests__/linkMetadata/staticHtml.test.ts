import { describe, expect, test } from "bun:test";
import { buildSelectorResultsFromHtml } from "../../linkMetadata/staticHtml";

const titleOf = (html: string) =>
  buildSelectorResultsFromHtml(html, [{ selector: "head > title" }])[0]
    .results[0]?.text;

const metaContentOf = (html: string) =>
  buildSelectorResultsFromHtml(html, [
    { selector: 'meta[property="og:title"]' },
  ])[0].results[0]?.attributes?.find((attr) => attr.name === "content")?.value;

describe("buildSelectorResultsFromHtml entity decoding", () => {
  test.each([
    ["&#x26;amp;", "&amp;"],
    ["&#38;lt;b&#38;gt;", "&lt;b&gt;"],
    ["&amp;lt;script&amp;gt;", "&lt;script&gt;"],
    ["Tom &amp; Jerry", "Tom & Jerry"],
    ["&lt;b&gt; &quot;hi&quot; &#39;x&#39; &#x41;&#66;", "<b> \"hi\" 'x' AB"],
    ["a&nbsp;b", "a b"],
    ["&unknown; stays", "&unknown; stays"],
    ["half &#xD83D; emoji &#128512;", "half &#xD83D; emoji \u{1F600}"],
  ])(
    "decodes %p in a title exactly once to %p",
    (encoded: string, decoded: string) => {
      expect(titleOf(`<title>${encoded}</title>`)).toBe(decoded);
    }
  );

  test("decodes meta attribute values exactly once", () => {
    expect(
      metaContentOf('<meta property="og:title" content="A &#x26;amp; B">')
    ).toBe("A &amp; B");
  });
});

describe("buildSelectorResultsFromHtml meta and link selectors", () => {
  const valuesOf = (html: string, selector: string, attribute: string) =>
    buildSelectorResultsFromHtml(html, [{ selector }])[0].results.map(
      (item) => item.attributes?.find((attr) => attr.name === attribute)?.value
    );

  test("matches YouTube's microdata by itemprop", () => {
    const html = `<meta itemprop="duration" content="PT1H2M3S">
      <span itemprop="author"><link itemprop="name" content="A Channel"></span>
      <meta itemprop="uploadDate" content="2024-05-01T07:00:00-07:00">`;
    expect(valuesOf(html, "meta[itemprop='duration']", "content")).toEqual([
      "PT1H2M3S",
    ]);
    expect(valuesOf(html, "link[itemprop='name']", "content")).toEqual([
      "A Channel",
    ]);
    expect(valuesOf(html, "meta[itemprop='uploadDate']", "content")).toEqual([
      "2024-05-01T07:00:00-07:00",
    ]);
  });

  test("a compound link selector needs every attribute to match", () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="https://feeds.example/rss">
      <link rel="alternate" type="application/atom+xml" href="https://feeds.example/atom">
      <link rel="alternate" hreflang="fr" href="https://example.fr/">`;
    expect(
      valuesOf(
        html,
        "link[rel='alternate'][type='application/rss+xml']",
        "href"
      )
    ).toEqual(["https://feeds.example/rss"]);
    expect(
      valuesOf(
        html,
        "link[rel='alternate'][type='application/atom+xml']",
        "href"
      )
    ).toEqual(["https://feeds.example/atom"]);
  });

  test("keeps matching name, property and rel selectors", () => {
    const html = `<meta name="twitter:creator" content="@a">
      <meta property="og:audio" content="https://cdn.example/a.mp3">
      <link rel="canonical" href="https://example.com/a">`;
    expect(valuesOf(html, "meta[name='twitter:creator']", "content")).toEqual([
      "@a",
    ]);
    expect(valuesOf(html, "meta[property='og:audio']", "content")).toEqual([
      "https://cdn.example/a.mp3",
    ]);
    expect(valuesOf(html, "link[rel='canonical']", "href")).toEqual([
      "https://example.com/a",
    ]);
  });
});
