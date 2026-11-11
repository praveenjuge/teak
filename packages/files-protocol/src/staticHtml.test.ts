import { describe, expect, test } from "bun:test";
import { buildSelectorResultsFromHtml } from "./staticHtml";

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

describe("buildSelectorResultsFromHtml on hostile pages", () => {
  const attributesOf = (html: string) =>
    buildSelectorResultsFromHtml(html, [{ selector: "meta[name='x']" }])[0]
      .results[0]?.attributes;

  test.each([
    ['<meta name="x" content=plain>', "plain"],
    ["<meta name='x' content='single'>", "single"],
    ['<meta name="x"content="no space">', "no space"],
    ['<meta name = "x" content = "spaced">', "spaced"],
    ['<META NAME="x" CONTENT="upper">', "upper"],
  ])("reads attributes written as %p", (html, content) => {
    expect(
      attributesOf(html)?.find((attr) => attr.name.toLowerCase() === "content")
        ?.value
    ).toBe(content);
  });

  test("drops an attribute whose quote never closes", () => {
    expect(attributesOf('<meta name="x" content="open>')).toEqual([
      { name: "name", value: "x" },
    ]);
  });

  test.each([
    ["<title data-x='1'>Hello</title>", "Hello"],
    ["<TITLE>Upper</TITLE>", "Upper"],
    ["<title>First</title><title>Second</title>", "First"],
    ["<title>Never closed", undefined],
  ])("reads the title of %p", (html, title) => {
    expect(titleOf(html)).toBe(title);
  });

  test.each([
    ["an attribute name", `<meta ${"!".repeat(200_000)}>`],
    ["an unclosed quote", `<meta ${'a="'.repeat(100_000)}>`],
    ["an unclosed title", "<title>a".repeat(100_000)],
    ["a run of unclosed tags", "<meta".repeat(100_000)],
  ])("reads a page with a huge %s in linear time", (_, html) => {
    const started = performance.now();
    buildSelectorResultsFromHtml(html, [
      { selector: "head > title" },
      { selector: "meta[name='x']" },
    ]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
