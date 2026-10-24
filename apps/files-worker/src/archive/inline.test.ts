import { describe, expect, test } from "bun:test";
import { createRewriter } from "./html";
import {
  buildPageArchive,
  type FetchedAsset,
  PAGE_ARCHIVE_BUDGET_BYTES,
  PAGE_ARCHIVE_MAX_INPUT_BYTES,
  PAGE_ARCHIVE_MAX_REQUESTS,
  PAGE_ARCHIVE_MAX_TEXT_BYTES,
  type PageArchiveDeps,
  pickImageCandidate,
} from "./inline";

const PAGE_URL = "https://example.com/blog/post";
const encode = (text: string) => new TextEncoder().encode(text);
const bytesOf = (size: number, fill = 7) => new Uint8Array(size).fill(fill);

interface Recorded {
  assets: Array<{ kind: string; url: string }>;
  sheets: string[];
}

const fakeDeps = (
  options: {
    assets?: Record<string, FetchedAsset | null>;
    defaultAsset?: (url: string, kind: "font" | "image") => FetchedAsset | null;
    /** Where a stylesheet request ends up, by the URL asked for. */
    redirects?: Record<string, string>;
    sheets?: Record<string, string | Uint8Array>;
    sheetType?: string;
  } = {}
): PageArchiveDeps & { recorded: Recorded } => {
  const recorded: Recorded = { assets: [], sheets: [] };
  return {
    fetchAsset: (url, kind) => {
      recorded.assets.push({ kind, url });
      if (options.assets && url in options.assets) {
        return Promise.resolve(options.assets[url] ?? null);
      }
      return Promise.resolve(
        options.defaultAsset?.(url, kind) ?? {
          body: bytesOf(16),
          contentType: kind === "font" ? "font/woff2" : "image/png",
          height: 10,
          width: 10,
        }
      );
    },
    fetchText: (url) => {
      recorded.sheets.push(url);
      const sheet = options.sheets?.[url];
      if (sheet === undefined) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        body: typeof sheet === "string" ? encode(sheet) : sheet,
        contentType: options.sheetType ?? "text/css",
        finalUrl: options.redirects?.[url],
      });
    },
    recorded,
  };
};

const archive = (
  html: string,
  deps: PageArchiveDeps = fakeDeps(),
  extra: Partial<Parameters<typeof buildPageArchive>[0]> = {}
) =>
  buildPageArchive({
    capturedAt: Date.UTC(2026, 9, 19),
    html,
    pageUrl: PAGE_URL,
    source: "server",
    ...deps,
    ...extra,
  });

/** Parses the archive the way a browser would, to read it back. */
const parse = (html: string) => {
  const found: {
    attributes: Array<{ name: string; tag: string; value: string }>;
    tags: string[];
  } = { attributes: [], tags: [] };
  return createRewriter()
    .on("*", {
      element(element) {
        found.tags.push(element.tagName);
        for (const [name, value] of element.attributes) {
          found.attributes.push({ name, tag: element.tagName, value });
        }
      },
    })
    .transform(new Response(html))
    .text()
    .then(() => found);
};

const HOSTILE_PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="windows-1252">
<meta http-equiv="refresh" content="0;url=https://evil.example">
<meta http-equiv="Content-Security-Policy" content="img-src https:">
<base href="javascript:alert(1)">
<link rel="preload" href="/app.js" as="script">
<link rel="modulepreload" href="/mod.js">
<link rel="manifest" href="/site.webmanifest">
<script>alert("head")</script>
<title>Hostile</title>
</head>
<body onload="steal()">
<noscript><p>Turn on JavaScript</p><script>alert("noscript")</script></noscript>
<p onclick="steal()" onmouseover="steal()">Read <a href="/other">the other post</a>,
<a href="javascript:alert(1)">a script link</a>, <a href=" JaVaScRiPt:alert(2)">another</a>,
<a href="data:text/html,<script>alert(3)</script>">a document link</a> and
<a href="#notes">the notes</a>.</p>
<iframe src="https://ads.example/frame"></iframe>
<object data="movie.swf"></object><embed src="movie.swf">
<video src="clip.mp4" poster="poster.png"><track src="subs.vtt"></video>
<audio src="song.mp3"></audio>
<portal src="https://example.com/next"></portal>
<template><script>alert("template")</script></template>
<form action="https://collect.example/post" method="post" target="_top">
<input name="q"><button formaction="https://collect.example/other" formtarget="_top">Go</button>
</form>
<svg><script>alert("svg")</script><a xlink:href="javascript:alert(4)"><text>x</text></a></svg>
<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cscript%3Ealert(5)%3C/script%3E%3C/svg%3E" alt="inline svg">
</body></html>`;

describe("buildPageArchive: stripping", () => {
  test("leaves no script, handler, frame, media or refresh behind", async () => {
    const result = await archive(HOSTILE_PAGE);
    const parsed = await parse(result.html);

    expect(result.kind).toBe("full");
    for (const tag of [
      "script",
      "iframe",
      "object",
      "embed",
      "video",
      "audio",
      "track",
      "portal",
      "template",
      "base",
      "link",
    ]) {
      expect(parsed.tags).not.toContain(tag);
    }
    expect(
      parsed.attributes.filter(({ name }) =>
        name.toLowerCase().startsWith("on")
      )
    ).toEqual([]);
    expect(
      parsed.attributes.filter(
        ({ name, value }) =>
          name === "http-equiv" && value.toLowerCase() === "refresh"
      )
    ).toEqual([]);
    expect(result.html.toLowerCase()).not.toContain("javascript:");
    expect(result.html).not.toContain("data:text/html");
    expect(result.html).not.toContain('alert("');
  });

  test("keeps noscript content as page content, without its scripts", async () => {
    const result = await archive(HOSTILE_PAGE);
    expect(result.html).toContain("<p>Turn on JavaScript</p>");
    expect(result.html).not.toContain('alert("noscript")');
  });

  test("makes forms inert", async () => {
    const parsed = await parse((await archive(HOSTILE_PAGE)).html);
    const formAttributes = parsed.attributes.filter(
      ({ tag }) => tag === "form" || tag === "button"
    );
    expect(formAttributes.map(({ name }) => name).sort()).toEqual([
      "data-teak-inert",
    ]);
  });

  test("keeps an inline SVG image, which can't run as an image", async () => {
    const parsed = await parse((await archive(HOSTILE_PAGE)).html);
    expect(
      parsed.attributes.find(({ name, tag }) => tag === "img" && name === "src")
        ?.value
    ).toStartWith("data:image/svg+xml,");
  });

  test("every link is absolute and opens a new tab, except in-page ones", async () => {
    const parsed = await parse((await archive(HOSTILE_PAGE)).html);
    const anchors = parsed.attributes.filter(
      ({ name, tag }) => tag === "a" && name === "href"
    );
    expect(anchors.map(({ value }) => value)).toEqual([
      "https://example.com/other",
      "#notes",
    ]);
    for (const { value } of anchors.filter(
      (anchor) => !anchor.value.startsWith("#")
    )) {
      expect(new URL(value).protocol).toBe("https:");
    }
    expect(
      parsed.attributes
        .filter(({ name, tag }) => tag === "a" && name === "rel")
        .map(({ value }) => value)
    ).toEqual(["noopener noreferrer"]);
  });
});

describe("buildPageArchive: header", () => {
  test("declares UTF-8, the archive's facts and a policy that denies scripts", async () => {
    const result = await archive(HOSTILE_PAGE);
    const parsed = await parse(result.html);
    const metas = parsed.attributes.filter(({ tag }) => tag === "meta");
    expect(
      metas.filter(({ name }) => name === "charset").map(({ value }) => value)
    ).toEqual(["utf-8"]);
    const csp = metas.find(
      ({ name, value }) =>
        name === "http-equiv" && value === "Content-Security-Policy"
    );
    expect(csp).toBeDefined();
    expect(result.html).toContain(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; media-src 'none'"
    );
    // The page's own policy, which could block the inlined images, is gone.
    expect(result.html).not.toContain("img-src https:");
  });

  test("escapes a page URL with quotes and markup inside the archive meta", async () => {
    const pageUrl = `https://example.com/?q="><script>alert('x')</script>&a=1`;
    const result = await archive("<p>Hi</p>", fakeDeps(), {
      pageUrl,
      source: "extension",
    });
    const parsed = await parse(result.html);
    expect(parsed.tags).not.toContain("script");
    const content = parsed.attributes.find(
      ({ name, value }) => name === "name" && value === "teak-archive"
    );
    expect(content).toBeDefined();
    const meta = /<meta name="teak-archive" content="([^"]*)">/u.exec(
      result.html
    )?.[1];
    expect(meta).not.toContain("<");
    expect(meta).not.toContain("'");
    expect(
      JSON.parse(
        (meta ?? "")
          .replaceAll("&quot;", '"')
          .replaceAll("&#39;", "'")
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">")
          .replaceAll("&amp;", "&")
      )
    ).toEqual({
      capturedAt: Date.UTC(2026, 9, 19),
      source: "extension",
      url: pageUrl,
    });
  });
});

describe("buildPageArchive: stylesheets and fonts", () => {
  test("inlines stylesheets, follows @import one level and stops a loop", async () => {
    const deps = fakeDeps({
      sheets: {
        "https://example.com/a.css": `@import url("b.css"); .a{color:red}`,
        "https://example.com/b.css": `@import "a.css"; .b{color:blue}`,
        "https://example.com/blog/inline-import.css": ".c{color:green}",
      },
    });
    const result = await archive(
      `<head><link rel="stylesheet" href="/a.css"><style>@import "inline-import.css"; .d{}</style></head><p>x</p>`,
      deps
    );
    expect(deps.recorded.sheets).toEqual([
      "https://example.com/a.css",
      "https://example.com/b.css",
      "https://example.com/blog/inline-import.css",
    ]);
    expect(result.html).toContain(".a{color:red}");
    expect(result.html).toContain(".b{color:blue}");
    expect(result.html).toContain(".c{color:green}");
    expect(result.html).not.toContain("@import");
  });

  test("keeps an import's media, supports and layer conditions around what it brings in", async () => {
    const deps = fakeDeps({
      sheets: {
        "https://example.com/grid.css": ".grid{display:grid}",
        "https://example.com/plain.css": ".plain{color:red}",
        "https://example.com/print.css": "body{display:none}",
        "https://example.com/theme.css": ".theme{color:blue}",
      },
    });
    const result = await archive(
      `<head><style>@import url("/print.css") print; @import "/grid.css" supports(display: grid) screen and (min-width: 40em); @import url(/theme.css) layer(theme); @import "/plain.css";</style></head><p>x</p>`,
      deps
    );
    expect(result.html).toContain("@media print{body{display:none}}");
    expect(result.html).toContain(
      "@supports (display: grid){@media screen and (min-width: 40em){.grid{display:grid}}}"
    );
    expect(result.html).toContain("@layer theme{.theme{color:blue}}");
    expect(result.html).toContain(".plain{color:red}");
    expect(result.html).not.toContain("@media all");
    expect(result.html).not.toContain("@import");
  });

  test("keeps url(#id) references into the page's own SVG, in sheets and style attributes", async () => {
    const result = await archive(
      `<head><style>.photo{clip-path:url(#crop)}.card{filter:url( "#shadow" )}</style></head>
      <body><svg><defs><clipPath id="crop"><circle r="5"/></clipPath><linearGradient id="g"/></defs>
      <rect style="fill:url('#g')"/></svg><p class="photo">x</p></body>`
    );
    expect(result.html).toContain('clip-path:url("#crop")');
    expect(result.html).toContain('filter:url("#shadow")');
    expect(result.html).toContain("fill:url(&quot;#g&quot;)");
    expect(result.html).not.toContain("url(data:,)");
  });

  test("resolves a redirected stylesheet's imports and assets against where it was served from", async () => {
    const deps = fakeDeps({
      redirects: {
        "https://example.com/theme.css": "https://cdn.example/v2/theme.css",
      },
      sheets: {
        "https://cdn.example/v2/parts.css": ".p{background:url(p.png)}",
        "https://example.com/theme.css": `@import "parts.css"; @font-face{font-family:A;src:url(font.woff2)} .a{background:url(bg.png)}`,
      },
    });
    await archive(
      `<head><link rel="stylesheet" href="/theme.css"></head><p class="a p">x</p>`,
      deps
    );
    expect(deps.recorded.sheets).toEqual([
      "https://example.com/theme.css",
      "https://cdn.example/v2/parts.css",
    ]);
    expect(deps.recorded.assets.map(({ url }) => url).sort()).toEqual([
      "https://cdn.example/v2/bg.png",
      "https://cdn.example/v2/font.woff2",
      "https://cdn.example/v2/p.png",
    ]);
  });

  test("reads character references in URLs and style attributes before fetching", async () => {
    const deps = fakeDeps({
      sheets: { "https://example.com/s.css?v=1&t=2": ".s{color:red}" },
    });
    const result = await archive(
      `<head><link rel="stylesheet" href="/s.css?v=1&amp;t=2"></head>
      <body><img src="/i.png?a=1&amp;b=2"><p style="background:url('/bg.png?a=1&amp;b=2')">x</p>
      <a href="/p?a=1&amp;b=2">next</a></body>`,
      deps
    );
    expect(deps.recorded.sheets).toEqual(["https://example.com/s.css?v=1&t=2"]);
    expect(deps.recorded.assets.map(({ url }) => url).sort()).toEqual([
      "https://example.com/bg.png?a=1&b=2",
      "https://example.com/i.png?a=1&b=2",
    ]);
    expect(result.html).toContain(".s{color:red}");
    expect(result.html).toContain('href="https://example.com/p?a=1&amp;b=2"');
    expect(result.html).not.toContain("amp;amp;");
  });

  test("keeps the fragment of an external SVG reference on its data URI", async () => {
    const svg: FetchedAsset = {
      body: new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><filter id="shadow"/></svg>'
      ),
      contentType: "image/svg+xml",
    };
    const result = await archive(
      `<head><style>.card{filter:url(/effects.svg#shadow)}.plain{background:url(/effects.svg)}</style></head><p class="card plain">x</p>`,
      fakeDeps({ defaultAsset: () => svg })
    );
    expect(result.html).toMatch(
      /filter:url\("data:image\/svg\+xml;base64,[^"#]+#shadow"\)/u
    );
    expect(result.html).toMatch(
      /background:url\("data:image\/svg\+xml;base64,[^"#]+"\)/u
    );
  });

  test("drops a stylesheet over 4 MiB", async () => {
    const big = `.big{color:red}${" ".repeat(PAGE_ARCHIVE_MAX_TEXT_BYTES + 1 - 15)}`;
    const result = await archive(
      `<link rel="stylesheet" href="/big.css"><link rel="stylesheet" href="/ok.css"><p>x</p>`,
      fakeDeps({
        sheets: {
          "https://example.com/big.css": big,
          "https://example.com/ok.css": ".ok{color:blue}",
        },
      })
    );
    expect(result.html).not.toContain(".big{color:red}");
    expect(result.html).toContain(".ok{color:blue}");
  });

  test("inlines one font per face, woff2 first, and CSS background images", async () => {
    const deps = fakeDeps({
      sheets: {
        "https://cdn.example.com/site.css": `@font-face{font-family:Serif;src:url(serif.ttf) format("truetype"),url(serif.woff) format("woff"),url(serif.woff2) format("woff2")}
          .hero{background:url('../img/hero.png') no-repeat}`,
      },
    });
    const result = await archive(
      `<link rel="stylesheet" href="https://cdn.example.com/site.css"><p>x</p>`,
      deps
    );
    expect(deps.recorded.assets).toEqual([
      { kind: "font", url: "https://cdn.example.com/serif.woff2" },
      { kind: "image", url: "https://cdn.example.com/img/hero.png" },
    ]);
    expect(result.html).toContain('src:url("data:font/woff2;base64,');
    expect(result.html).not.toContain("serif.ttf");
    expect(result.html).toContain('background:url("data:image/png;base64,');
  });

  test("decodes a stylesheet in the charset its Content-Type names", async () => {
    // "日本" in Shift-JIS.
    const shiftJis = new Uint8Array([
      ...encode('.jp::after{content:"'),
      0x93,
      0xfa,
      0x96,
      0x7b,
      ...encode('"}'),
    ]);
    const result = await archive(
      `<link rel="stylesheet" href="/jp.css"><p>x</p>`,
      fakeDeps({
        sheets: { "https://example.com/jp.css": shiftJis },
        sheetType: "text/css; charset=shift_jis",
      })
    );
    expect(result.html).toContain('.jp::after{content:"日本"}');
  });

  test("stops at 40 stylesheets", async () => {
    const links = Array.from(
      { length: 45 },
      (_, index) => `<link rel="stylesheet" href="/s${index}.css">`
    ).join("");
    const deps = fakeDeps({
      sheets: Object.fromEntries(
        Array.from({ length: 45 }, (_, index) => [
          `https://example.com/s${index}.css`,
          `.s${index}{}`,
        ])
      ),
    });
    const result = await archive(`${links}<p>x</p>`, deps);
    expect(deps.recorded.sheets).toHaveLength(40);
    expect(result.html).toContain(".s39{}");
    expect(result.html).not.toContain(".s40{}");
  });
});

describe("buildPageArchive: images", () => {
  test.each([
    {
      name: "the widest srcset width at or under 1600",
      attributes: {
        srcset: "a-400.jpg 400w, a-1600.jpg 1600w, a-2400.jpg 2400w",
      },
      expected: "https://example.com/blog/a-1600.jpg",
    },
    {
      name: "the narrowest when every width is over 1600",
      attributes: { srcset: "b-3000.jpg 3000w, b-2000.jpg 2000w" },
      expected: "https://example.com/blog/b-2000.jpg",
    },
    {
      name: "2x from density descriptors alone",
      attributes: { srcset: "c.jpg 1x, c@2x.jpg 2x, c@3x.jpg 3x" },
      expected: "https://example.com/blog/c@2x.jpg",
    },
    {
      name: "a lazy-loading data-src over a placeholder src",
      attributes: { dataSrc: "/real.jpg", src: "/blank.gif" },
      expected: "https://example.com/real.jpg",
    },
    {
      name: "nothing for a file: URL",
      attributes: { src: "file:///etc/passwd" },
      expected: null,
    },
  ])("picks $name", ({ attributes, expected }) => {
    expect(pickImageCandidate(attributes, PAGE_URL)).toBe(expected);
  });

  test("inlines the picture's chosen source into its img", async () => {
    const deps = fakeDeps();
    const result = await archive(
      `<picture><source type="image/webp" srcset="/p-800.webp 800w, /p-2000.webp 2000w"><img src="/p.jpg" alt="A lake"></picture>`,
      deps
    );
    expect(deps.recorded.assets).toEqual([
      { kind: "image", url: "https://example.com/p-800.webp" },
    ]);
    const parsed = await parse(result.html);
    expect(parsed.tags).not.toContain("source");
    expect(
      parsed.attributes.find(({ name }) => name === "src")?.value
    ).toStartWith("data:image/png;base64,");
  });

  test("never requests a file: image, and leaves a refused one as a placeholder box", async () => {
    const deps = fakeDeps({
      assets: { "http://127.0.0.1/secret.png": null },
    });
    const result = await archive(
      `<img src="file:///etc/passwd" alt="local"><img src="http://127.0.0.1/secret.png" alt="loopback" width="40" height="30">`,
      deps
    );
    expect(deps.recorded.assets.map(({ url }) => url)).toEqual([
      "http://127.0.0.1/secret.png",
    ]);
    const parsed = await parse(result.html);
    const loopback = parsed.attributes.filter(({ tag }) => tag === "img");
    expect(
      loopback.filter(({ name }) => name === "data-teak-dropped")
    ).toHaveLength(2);
    expect(result.html).toContain('alt="loopback" width="40" height="30"');
    expect(result.html).not.toContain("127.0.0.1");
    expect(result.html).not.toContain("file:");
  });

  test("re-encodes an image wider than 1600 pixels", async () => {
    const widths: number[] = [];
    const deps = fakeDeps({
      defaultAsset: () => ({
        body: bytesOf(64),
        contentType: "image/jpeg",
        height: 2000,
        width: 3200,
      }),
    });
    const result = await archive(`<img src="/wide.jpg">`, {
      ...deps,
      images: {
        resize: (_asset, width) => {
          widths.push(width);
          return Promise.resolve({
            body: bytesOf(8),
            contentType: "image/webp",
            height: 1000,
            width,
          });
        },
      },
    });
    expect(widths).toEqual([1600]);
    expect(result.html).toContain('src="data:image/webp;base64,');
  });

  test("keeps an image already inlined in the page and counts it", async () => {
    const inline = `data:image/png;base64,${"A".repeat(2 * 1024 * 1024)}`;
    const deps = fakeDeps();
    const result = await archive(`<p>Big</p><img src="${inline}">`, deps);
    expect(deps.recorded.assets).toEqual([]);
    expect(result.kind).toBe("full");
    expect(result.html).toContain(inline);
    expect(result.bytes).toBeGreaterThan(2 * 1024 * 1024);
    expect(result.bytes).toBe(encode(result.html).byteLength);
  });
});

describe("buildPageArchive: budget", () => {
  test("300 images totalling 60 MB: at most 200 requests and 60 MiB in, 20 MiB out, largest dropped first", async () => {
    const sizes = Array.from(
      { length: 300 },
      (_, index) => 100 * 1024 + ((index * 7919) % 200) * 1024
    );
    const images = sizes
      .map((_, index) => `<img src="/i/${index}.png" alt="image ${index}">`)
      .join("");
    const deps = fakeDeps({
      defaultAsset: (url) => {
        const index = Number(/\/i\/(\d+)\.png$/u.exec(url)?.[1]);
        return {
          body: bytesOf(sizes[index] ?? 0),
          contentType: "image/png",
          height: 100,
          width: 100,
        };
      },
    });
    const result = await archive(`<p>Gallery</p>${images}`, deps);

    expect(result.kind).toBe("full");
    expect(result.bytes).toBeLessThanOrEqual(PAGE_ARCHIVE_BUDGET_BYTES);
    expect(deps.recorded.assets.length).toBeLessThanOrEqual(
      PAGE_ARCHIVE_MAX_REQUESTS
    );
    const fetchedBytes = deps.recorded.assets.reduce((sum, { url }) => {
      const index = Number(/\/i\/(\d+)\.png$/u.exec(url)?.[1]);
      return sum + (sizes[index] ?? 0);
    }, 0);
    // The request that crosses the limit is the last one let through.
    expect(fetchedBytes).toBeLessThan(
      PAGE_ARCHIVE_MAX_INPUT_BYTES + 300 * 1024
    );

    const parsed = await parse(result.html);
    const imgs: Array<{ alt?: string; dropped: boolean }> = [];
    for (const attribute of parsed.attributes.filter(
      ({ tag }) => tag === "img"
    )) {
      if (attribute.name === "alt") {
        imgs.push({ alt: attribute.value, dropped: false });
      }
      if (attribute.name === "data-teak-dropped") {
        (imgs.at(-1) as { dropped: boolean }).dropped = true;
      }
    }
    const fetched = new Set(deps.recorded.assets.map(({ url }) => url));
    const sizeOf = (alt?: string) => sizes[Number(alt?.split(" ")[1])] ?? 0;
    const keptSizes = imgs
      .filter((img) => !img.dropped)
      .map((img) => sizeOf(img.alt));
    const droppedFetchedSizes = imgs
      .filter(
        (img) =>
          img.dropped &&
          fetched.has(`https://example.com/i/${img.alt?.split(" ")[1]}.png`)
      )
      .map((img) => sizeOf(img.alt));
    expect(keptSizes.length).toBeGreaterThan(0);
    expect(droppedFetchedSizes.length).toBeGreaterThan(0);
    expect(Math.max(...keptSizes)).toBeLessThanOrEqual(
      Math.min(...droppedFetchedSizes)
    );
    // Every image keeps its alt text, kept or not.
    expect(imgs).toHaveLength(300);
  }, 30_000);

  test("an archive exactly at the budget is kept whole", async () => {
    const page = `<p>Fits</p><img src="/one.png">`;
    const deps = () =>
      fakeDeps({
        defaultAsset: () => ({
          body: bytesOf(4096),
          contentType: "image/png",
        }),
      });
    const whole = await archive(page, deps());
    const atBudget = await archive(page, deps(), {
      budgetBytes: whole.bytes,
    });
    expect(atBudget).toMatchObject({
      bytes: whole.bytes,
      dropped: 0,
      kind: "full",
    });
    const underBudget = await archive(page, deps(), {
      budgetBytes: whole.bytes - 1,
    });
    expect(underBudget.kind).toBe("full");
    expect(underBudget.dropped).toBe(1);
  });

  describe("drops fonts only once every image is gone", () => {
    const deps = fakeDeps({
      defaultAsset: (_url, kind) => ({
        // Fonts weigh more than images, so size alone would drop them first.
        body: bytesOf(kind === "font" ? 3000 : 1000),
        contentType: kind === "font" ? "font/woff2" : "image/png",
        height: 1,
        width: 1,
      }),
      sheets: {
        "https://example.com/fonts.css":
          "@font-face{font-family:A;src:url(a.woff2)}@font-face{font-family:B;src:url(b.woff2)}",
      },
    });
    const page = `<link rel="stylesheet" href="/fonts.css"><p>Type specimen</p><img src="/x.png"><img src="/y.png">`;

    test("one byte over: an image goes, both fonts stay", async () => {
      const whole = await archive(page, deps);
      const result = await archive(page, deps, {
        budgetBytes: whole.bytes - 1,
      });
      expect(result).toMatchObject({ dropped: 1, kind: "full" });
      expect(result.html.match(/data:font\/woff2/gu)).toHaveLength(2);
      expect(result.html.match(/data:image\/png/gu)).toHaveLength(1);
    });

    test("more than both images save: then one font goes", async () => {
      const whole = await archive(page, deps);
      const result = await archive(page, deps, {
        budgetBytes: whole.bytes - 3000,
      });
      expect(result).toMatchObject({ dropped: 3, kind: "full" });
      expect(result.html.match(/data:font\/woff2/gu)).toHaveLength(1);
      expect(result.html).not.toContain("data:image/png");
    });
  });

  test("stops fetching once the deadline passes", async () => {
    const deps = fakeDeps();
    const result = await archive(`<img src="/late.png">`, deps, {
      deadline: Date.now() - 1,
    });
    expect(deps.recorded.assets).toEqual([]);
    expect(result.html).toContain("data-teak-dropped");
  });
});

describe("buildPageArchive: text-only", () => {
  const hugeCss = `.x{content:"${"x".repeat(1024)}"}`.repeat(64);

  test("past the budget with HTML and CSS alone, keeps the title and body text", async () => {
    const page = `<html lang="en"><head><title>Long read</title><style>${hugeCss}</style></head>
      <body><h2>Chapter one</h2><p>It was a <a href="/dark">dark</a> night.</p>
      <ul><li>First point</li><li>Second point</li></ul>
      <blockquote>A quote</blockquote><pre>code   kept</pre>
      <div>Loose text in a div</div><script>alert(1)</script></body></html>`;
    const result = await archive(page, fakeDeps(), { budgetBytes: 32 * 1024 });

    expect(result.kind).toBe("text_only");
    expect(result.bytes).toBeLessThanOrEqual(32 * 1024);
    const parsed = await parse(result.html);
    expect(parsed.tags).not.toContain("script");
    expect(result.html).toContain("<p>Text-only copy</p>");
    expect(result.html).toContain('<h1 dir="auto">Long read</h1>');
    expect(result.html).toContain('<h2 dir="auto">Chapter one</h2>');
    expect(result.html).toContain(
      'It was a <a href="https://example.com/dark" target="_blank" rel="noopener noreferrer">dark</a> night.'
    );
    expect(result.html).toContain('<li dir="auto">Second point</li>');
    expect(result.html).toContain(
      '<blockquote dir="auto">A quote</blockquote>'
    );
    expect(result.html).toContain('<pre dir="auto">code   kept</pre>');
    expect(result.html).toContain('<p dir="auto">Loose text in a div</p>');
    expect(result.html).not.toContain(".x{content");
    expect(result.html).toContain("default-src 'none'");
  });

  test("shows character references in the text and title as the page does", async () => {
    const page = `<head><title>Tom &amp; Jerry&#8217;s</title><style>${hugeCss}</style></head><body><p>Fish &amp; chips &lt;b&gt; caf&eacute; &#x1F600;</p><pre>a &lt; b &amp;&amp; c</pre></body>`;
    const result = await archive(page, fakeDeps(), { budgetBytes: 32 * 1024 });
    expect(result.kind).toBe("text_only");
    expect(result.html).toContain("<title>Tom &amp; Jerry\u2019s</title>");
    expect(result.html).toContain('<h1 dir="auto">Tom &amp; Jerry\u2019s</h1>');
    expect(result.html).toContain(
      '<p dir="auto">Fish &amp; chips &lt;b&gt; caf\u00e9 \u{1F600}</p>'
    );
    expect(result.html).toContain(
      '<pre dir="auto">a &lt; b &amp;&amp; c</pre>'
    );
    expect(result.html).not.toContain("&amp;amp;");
  });

  test("keeps an RTL Arabic article's language and direction", async () => {
    const page = `<html lang="ar" dir="rtl"><head><title>مقال طويل</title><style>${hugeCss}</style></head><body><p>هذا نص عربي.</p></body></html>`;
    const result = await archive(page, fakeDeps(), { budgetBytes: 32 * 1024 });
    expect(result.kind).toBe("text_only");
    expect(result.html).toContain('<html lang="ar" dir="rtl">');
    expect(result.html).toContain('<p dir="auto">هذا نص عربي.</p>');
  });

  test("never exceeds the budget, even with more text than fits", async () => {
    const paragraphs = "<p>Many words in a paragraph.</p>".repeat(5000);
    const result = await archive(
      `<style>${hugeCss}</style>${paragraphs}<p>The very last words.</p>`,
      fakeDeps(),
      { budgetBytes: 64 * 1024 }
    );
    expect(result.kind).toBe("text_only");
    expect(result.bytes).toBeLessThanOrEqual(64 * 1024);
    expect(result.html).toContain("Many words in a paragraph.");
    expect(result.html).not.toContain("The very last words.");
    expect(result.html).toEndWith("</body></html>");
  });
});

describe("buildPageArchive: pages", () => {
  test("a CJK page declared in Shift-JIS comes out as UTF-8 with its text", async () => {
    const result = await archive(
      `<html lang="ja"><head><meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS"><title>日本語のページ</title></head><body><p>こんにちは、世界。</p></body></html>`
    );
    expect(result.html).toContain("<p>こんにちは、世界。</p>");
    expect(result.html.toLowerCase()).not.toContain("shift_jis");
    expect(result.html).toContain('<meta charset="utf-8">');
  });

  test("an RTL Arabic article keeps its markup and direction", async () => {
    const result = await archive(
      `<html lang="ar" dir="rtl"><body><article><h1>عنوان</h1><p>نص المقال.</p></article></body></html>`
    );
    expect(result.kind).toBe("full");
    expect(result.html).toContain('<html lang="ar" dir="rtl">');
    expect(result.html).toContain("<p>نص المقال.</p>");
  });

  test("a JS-only app shell archives near-empty from the server, and whole from the extension", async () => {
    const shell = `<html><head><title>App</title><script src="/app.js"></script></head><body><div id="root"></div></body></html>`;
    const rendered = `<html><head><title>App</title><base href="${PAGE_URL}"></head><body><div id="root"><h1>Rendered story</h1><p>Only the browser saw this.</p></div></body></html>`;
    const server = await archive(shell);
    const extension = await archive(rendered, fakeDeps(), {
      source: "extension",
    });
    expect(server.html).not.toContain("Rendered story");
    expect(server.html).not.toContain("<script");
    expect(extension.html).toContain("<h1>Rendered story</h1>");
    expect(extension.html).toContain("Only the browser saw this.");
  });

  test("a font-heavy page inlines every face it can", async () => {
    const faces = Array.from(
      { length: 12 },
      (_, index) =>
        `@font-face{font-family:F${index};src:url(f${index}.woff2) format("woff2"),url(f${index}.woff) format("woff")}`
    ).join("");
    const deps = fakeDeps({
      defaultAsset: (_url, kind) => ({
        body: bytesOf(kind === "font" ? 200 * 1024 : 10),
        contentType: kind === "font" ? "font/woff2" : "image/png",
      }),
      sheets: { "https://example.com/type.css": faces },
    });
    const result = await archive(
      `<link rel="stylesheet" href="/type.css"><p>Specimen</p>`,
      deps
    );
    expect(deps.recorded.assets.map(({ url }) => url)).toEqual(
      Array.from(
        { length: 12 },
        (_, index) => `https://example.com/f${index}.woff2`
      )
    );
    expect(result.html.match(/data:font\/woff2;base64,/gu)).toHaveLength(12);
  });

  test("relative URLs follow the page's base element", async () => {
    const deps = fakeDeps();
    const result = await archive(
      `<head><base href="https://cdn.example.org/assets/"></head><body><img src="pic.png"><a href="doc">Doc</a></body>`,
      deps
    );
    expect(deps.recorded.assets).toEqual([
      { kind: "image", url: "https://cdn.example.org/assets/pic.png" },
    ]);
    expect(result.html).toContain('href="https://cdn.example.org/assets/doc"');
  });
});
