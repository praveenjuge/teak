import { describe, expect, test } from "bun:test";
import { parseLinkPreview } from "../../../../packages/convex/linkMetadata/parsing";
import { SCRAPE_ELEMENTS } from "../../../../packages/convex/linkMetadata/selectors";
import type { PinnedFetch } from "../../../../packages/convex/linkMetadata/ssrf";
import { buildSelectorResultsFromHtml } from "../../../../packages/convex/linkMetadata/staticHtml";
import { decodeHtml, MAX_PAGE_BYTES } from "./fetchPage";
import { createFetcherHandler } from "./handler";
import { FETCHER_MAX_IN_FLIGHT, type FetcherPageResponse } from "./protocol";

const PUBLIC = "93.184.216.34";
const PAGE = "https://site.example/post";
const SELECTORS = SCRAPE_ELEMENTS.map((element) => element.selector);

const html = (headers: Record<string, string> = {}) => ({
  "content-type": "text/html; charset=utf-8",
  ...headers,
});

const setup = (
  respond: (url: string) => Response | Promise<Response>,
  dns: Record<string, string[]> = { "site.example": [PUBLIC] }
) => {
  const calls: { headers: Headers; url: string }[] = [];
  const pinnedFetch: PinnedFetch = (url, _addresses, init) => {
    calls.push({ headers: new Headers(init.headers), url });
    return Promise.resolve(respond(url));
  };
  const handle = createFetcherHandler({
    pinnedFetch,
    resolveDns: (hostname) => Promise.resolve(dns[hostname] ?? []),
  });
  const fetchPage = (body: unknown) =>
    handle(
      new Request("http://fetcher/fetch-page", {
        body: JSON.stringify(body),
        method: "POST",
      })
    );
  return { calls, fetchPage, handle };
};

// Pages covering what the Convex parser reads: Open Graph, Twitter and plain
// meta tags, link rels, titles, entities, tags in odd places.
const PAGES: Record<string, string> = {
  "open graph and twitter": `<!doctype html><html><head>
    <title>Fallback title</title>
    <meta property="og:title" content="OG &amp; title">
    <meta property="og:description" content="Desc with &quot;quotes&quot; &#39;and&#39; &#x2014; dash">
    <meta property="og:image" content="/img/cover.png">
    <meta property="og:site_name" content="Site">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="https://cdn.example/t.jpg">
    <link rel="icon" href="/favicon.ico">
    <link rel="canonical" href="https://site.example/canonical">
  </head><body><p>Hi</p></body></html>`,
  "plain meta, upper-case attributes": `<HTML><HEAD><TITLE>  Spaced
      title  </TITLE><META NAME="Description" CONTENT='Single quoted'>
    <META NAME=author CONTENT=Unquoted><LINK REL="apple-touch-icon" HREF="/apple.png">
    </HEAD></HTML>`,
  "tags outside head": `<html><body>
    <svg><title>SVG title first</title></svg>
    <script>var s = '<meta property="og:title" content="in a script">';</script>
    <!-- <meta name="description" content="in a comment"> -->
    <meta property="article:published_time" content="2026-10-15T09:00:00Z">
  </body></html>`,
  "nothing to match": "<html><body><div id=app></div></body></html>",
};

describe("page parsing parity with Convex", () => {
  test.each(Object.entries(PAGES))(
    "%s: the same selector results and preview as Convex's parser",
    async (_name, page) => {
      const { fetchPage } = setup(
        () => new Response(page, { headers: html() })
      );
      const response = await fetchPage({ selectors: SELECTORS, url: PAGE });
      expect(response.status).toBe(200);
      const body = (await response.json()) as FetcherPageResponse;
      // What Convex's fetchMetadata step computes from the same body.
      const convexSelectors = buildSelectorResultsFromHtml(
        new TextDecoder().decode(new TextEncoder().encode(page)),
        SCRAPE_ELEMENTS
      );
      expect(body.selectors).toEqual(convexSelectors);
      expect(parseLinkPreview(PAGE, body.selectors)).toEqual(
        parseLinkPreview(PAGE, convexSelectors)
      );
      expect(body.html).toBe(page);
      expect(body.charset).toBe("utf-8");
      expect(body.pageUrl).toBe(PAGE);
    }
  );

  test("matches only the selectors it was given, in their order", async () => {
    const { fetchPage } = setup(
      () => new Response(PAGES["open graph and twitter"], { headers: html() })
    );
    const response = await fetchPage({
      selectors: ["meta[property='og:image']", "head > title"],
      url: PAGE,
    });
    const body = (await response.json()) as FetcherPageResponse;
    expect(body.selectors.map((entry) => entry.selector)).toEqual([
      "meta[property='og:image']",
      "head > title",
    ]);
    expect(body.selectors[1]?.results).toEqual([{ text: "Fallback title" }]);
  });
});

describe("fetching", () => {
  test("sends the browser user agent and HTML accept header, pinned to the checked address", async () => {
    const { calls, fetchPage } = setup(
      () => new Response("<title>x</title>", { headers: html() })
    );
    await fetchPage({ selectors: SELECTORS, url: PAGE });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get("user-agent")).toContain("Chrome/120");
    expect(calls[0]?.headers.get("accept")).toBe(
      "text/html,application/xhtml+xml"
    );
    expect(calls[0]?.headers.get("referer")).toBeNull();
  });

  test("reports the URL after redirects", async () => {
    const { calls, fetchPage } = setup((url) => {
      if (url === PAGE) {
        return new Response(null, {
          headers: { location: "/final" },
          status: 301,
        });
      }
      const response = new Response("<title>Final</title>", {
        headers: html(),
      });
      // undici sets this on a real response; safeFetch passes it through.
      Object.defineProperty(response, "url", { value: url });
      return response;
    });
    const body = (await (
      await fetchPage({ selectors: SELECTORS, url: PAGE })
    ).json()) as FetcherPageResponse;
    expect(calls.map((call) => call.url)).toEqual([
      PAGE,
      "https://site.example/final",
    ]);
    expect(body.pageUrl).toBe("https://site.example/final");
  });

  test.each([
    [
      "a private address",
      () => new Response("x", { headers: html() }),
      { "site.example": ["10.0.0.5"] },
      { reason: "blocked_url" },
    ],
    [
      "a redirect to a private address",
      (url: string) =>
        url === PAGE
          ? Response.redirect("https://inside.example/", 302)
          : new Response("x", { headers: html() }),
      { "inside.example": ["127.0.0.1"], "site.example": [PUBLIC] },
      { reason: "blocked_url" },
    ],
    [
      "a 404",
      () => new Response("gone", { headers: html(), status: 404 }),
      undefined,
      { reason: "http_error", status: 404 },
    ],
    [
      "a PDF",
      () =>
        new Response("%PDF", {
          headers: { "content-type": "application/pdf" },
        }),
      undefined,
      { contentType: "application/pdf", reason: "unsupported_type" },
    ],
    [
      "a declared length over 2 MiB",
      () =>
        new Response("x", {
          headers: html({ "content-length": String(MAX_PAGE_BYTES + 1) }),
        }),
      undefined,
      { reason: "too_large" },
    ],
    [
      "a body over 2 MiB without a length",
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_PAGE_BYTES + 1));
              controller.close();
            },
          }),
          { headers: html() }
        ),
      undefined,
      { reason: "too_large" },
    ],
    [
      "a redirect loop",
      () => Response.redirect(PAGE, 302),
      undefined,
      { reason: "fetch_failed" },
    ],
    [
      "a network failure",
      () => Promise.reject(new TypeError("connect ECONNREFUSED")),
      undefined,
      { reason: "fetch_failed" },
    ],
  ] as const)("refuses %s with 422", async (_label, respond, dns, expected) => {
    const { fetchPage } = setup(
      respond,
      dns as unknown as Record<string, string[]> | undefined
    );
    const response = await fetchPage({ selectors: SELECTORS, url: PAGE });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "skipped", ...expected });
  });

  test.each([
    ["no URL", { selectors: SELECTORS }],
    ["no selectors", { selectors: [], url: PAGE }],
    ["a non-string selector", { selectors: [1], url: PAGE }],
    [
      "too many selectors",
      { selectors: new Array(129).fill("title"), url: PAGE },
    ],
  ])("rejects a request with %s", async (_label, body) => {
    const { calls, fetchPage } = setup(() => new Response("x"));
    expect((await fetchPage(body)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  test("shares the in-flight limit with asset downloads", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchPage } = setup(async () => {
      await held;
      return new Response("<title>x</title>", { headers: html() });
    });
    const running = Array.from({ length: FETCHER_MAX_IN_FLIGHT }, () =>
      fetchPage({ selectors: SELECTORS, url: PAGE })
    );
    const refused = await fetchPage({ selectors: SELECTORS, url: PAGE });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "busy" });
    release();
    for (const response of await Promise.all(running)) {
      expect(response.status).toBe(200);
    }
  });
});

describe("decoding", () => {
  // "Café – naïve" in windows-1252.
  const cp1252 = (prefix: string) =>
    new Uint8Array([
      ...new TextEncoder().encode(prefix),
      0x43,
      0x61,
      0x66,
      0xe9,
      0x20,
      0x96,
      0x20,
      0x6e,
      0x61,
      0xef,
      0x76,
      0x65,
    ]);

  test("uses the Content-Type charset", () => {
    expect(
      decodeHtml(cp1252("<title>"), "text/html; charset=windows-1252")
    ).toEqual({ charset: "windows-1252", html: "<title>Café – naïve" });
  });

  test.each([
    ['<meta charset="iso-8859-1"><title>'],
    [
      '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>',
    ],
  ])("falls back to a <meta> charset near the top: %s", (prefix) => {
    const { charset, html: decoded } = decodeHtml(cp1252(prefix), "text/html");
    expect(charset).toBe("windows-1252");
    expect(decoded.endsWith("Café – naïve")).toBe(true);
  });

  test("ignores a <meta> charset past the first 1024 bytes", () => {
    const late = `${" ".repeat(1100)}<meta charset="windows-1252">`;
    expect(decodeHtml(cp1252(late), "text/html").charset).toBe("utf-8");
  });

  test("prefers a byte order mark to every declaration", () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("<title>Café</title>"),
    ]);
    expect(decodeHtml(bytes, "text/html; charset=windows-1252")).toEqual({
      charset: "utf-8",
      html: "<title>Café</title>",
    });
  });

  test.each([
    ["no declaration", "text/html"],
    ["an unknown charset", "text/html; charset=not-a-charset"],
    ["a UTF-16 <meta> in ASCII bytes", "text/html"],
  ])("decodes as UTF-8 with %s", (label, contentType) => {
    const page =
      label === "a UTF-16 <meta> in ASCII bytes"
        ? '<meta charset="utf-16"><title>Café</title>'
        : "<title>Café</title>";
    expect(decodeHtml(new TextEncoder().encode(page), contentType)).toEqual({
      charset: "utf-8",
      html: page,
    });
  });
});

describe("cacheability", () => {
  test.each([
    [undefined, true],
    ["public, max-age=600", true],
    ["no-cache", true],
    ["no-store", false],
    ["private", false],
    ["Private, max-age=0", false],
    ['private="set-cookie", max-age=60', false],
    ["max-age=0, no-store, must-revalidate", false],
  ])("Cache-Control %p: cacheable %p", async (cacheControl, cacheable) => {
    const { fetchPage } = setup(
      () =>
        new Response("<title>x</title>", {
          headers: html(cacheControl ? { "cache-control": cacheControl } : {}),
        })
    );
    const body = (await (
      await fetchPage({ selectors: SELECTORS, url: PAGE })
    ).json()) as FetcherPageResponse;
    expect(body.cacheable).toBe(cacheable);
  });
});
