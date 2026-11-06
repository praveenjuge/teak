import { describe, expect, test } from "bun:test";
import { readDocsHtml } from "./docs-html";

describe("readDocsHtml", () => {
  test("decodes and trims only the first title", () => {
    expect(
      readDocsHtml(
        "<title>  Teak &amp; notes &#x2014; &#169;  </title><title>Later</title>"
      ).title
    ).toBe("Teak & notes — ©");
  });

  test("preserves a missing or blank first title for the crawl assertion", () => {
    expect(readDocsHtml("<p>No title</p>").title).toBeUndefined();
    expect(
      readDocsHtml("<title>  </title><title>Later title</title>").title
    ).toBe("");
  });

  test("ignores markup in scripts, styles and comments", () => {
    expect(
      readDocsHtml(`
        <script>const fake = '<title>Fake</title><a href="/fake">';</script>
        <style>/* <a href="/style"> */</style>
        <!-- <title>Comment</title><a href="/comment"> -->
        <title>Real</title><a href="/real">Real</a>
      `)
    ).toEqual({ internalLinks: ["/real"], title: "Real" });
  });

  test("reads uppercase tags and attributes, unquoted links and entities", () => {
    expect(
      readDocsHtml(`
        <TITLE>Docs &amp; guides</TITLE>
        <A HREF=/docs/start>Start</A>
        <a href="/search?a=1&amp;b=2">Search</a>
        <a href='/caf&#233;'>Café</a>
      `)
    ).toEqual({
      internalLinks: ["/docs/start", "/search?a=1&b=2", "/café"],
      title: "Docs & guides",
    });
  });

  test("keeps the original slash prefix and Cloudflare exclusions", () => {
    expect(
      readDocsHtml(`
        <a href="https://example.org/">External</a>
        <a href="#section">Fragment</a>
        <a href="relative">Relative</a>
        <a href="mailto:hello@example.org">Email</a>
        <a href="">Empty</a><a>Missing</a>
        <div href="/wrong-element">Not an anchor</div>
        <a href=" /leading-space">Space</a>
        <a href="/cdn-cgi/l/email-protection#123">Obfuscated</a>
        <a href="/">Root</a>
        <a href="/cdn-cgi">No trailing slash</a>
        <a href="/CDN-CGI/path">Case is significant</a>
        <a href="//example.org/path">Protocol relative</a>
      `).internalLinks
    ).toEqual(["/", "/cdn-cgi", "/CDN-CGI/path", "//example.org/path"]);
  });

  test("preserves document order and duplicate links", () => {
    expect(
      readDocsHtml('<a href="/b">B</a><a href="/a">A</a><a href="/b">Again</a>')
        .internalLinks
    ).toEqual(["/b", "/a", "/b"]);
  });

  test("limits after exclusions and before the crawl deduplicates links", () => {
    const excluded = '<a href="/cdn-cgi/ignored">Skip</a>'.repeat(25);
    const repeated = '<a href="/same">Repeated</a>'.repeat(19);
    expect(
      readDocsHtml(
        `${excluded}${repeated}<a href="/twentieth">Keep</a><a href="/last">Skip</a>`
      ).internalLinks
    ).toEqual([...Array.from({ length: 19 }, () => "/same"), "/twentieth"]);
  });
});
