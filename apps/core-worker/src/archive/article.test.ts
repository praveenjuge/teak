import { describe, expect, test } from "bun:test";
import { FakeBucket } from "../test/testsupport";
import {
  type EncodeArticleImage,
  extractArticle,
  parseExtractArticleParams,
  runExtractArticle,
} from "./article";

const PAGE_URL = "https://site.example/blog/post";
const ARCHIVE_KEY = "users/u1/cards/c1/page-archive/r1-archive.html";

const sentences = (count: number, from = 0) =>
  Array.from(
    { length: count },
    (_, index) =>
      `Sentence ${from + index} explains how careful readers keep their notes.`
  ).join(" ");

const pngDataUri = (seed: string) =>
  `data:image/png;base64,${btoa(`PNG-${seed}-`.repeat(40))}`;

const encodeImage: EncodeArticleImage = ({ body }) =>
  Promise.resolve(body.slice(0, 16));

const page = (body: string, attributes = 'lang="en"') =>
  `<!doctype html><html ${attributes}><head><meta charset="utf-8"><meta name="teak-archive" content="{}"><title>A careful guide to notes - Site</title><style>p{color:red}</style></head><body><header><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>${body}<footer>Copyright</footer></body></html>`;

const decoded = (base64: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  );

describe("extractArticle", () => {
  test("keeps the reading order of content before and after <body>", async () => {
    const html = `<!doctype html><html lang="en"><head><title>A guide</title></head><article><p>FIRSTMARK ${sentences(12)}</p></article><body><p>SECONDMARK ${sentences(12, 20)}</p></body><p>THIRDMARK ${sentences(12, 40)}</p></html>`;
    const result = await extractArticle(html, PAGE_URL);
    if (result.kind !== "article") {
      throw new Error(`expected an article, got ${result.kind}`);
    }
    const order = ["FIRSTMARK", "SECONDMARK", "THIRDMARK"].map((mark) =>
      result.markdown.indexOf(mark)
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("reads an article from a page with no <body> tag or content after it", async () => {
    const paragraph = `<p>${sentences(12)}</p>`;
    for (const html of [
      `<!doctype html><html lang="en"><head><title>A guide</title></head><div><div>${paragraph}${paragraph}</div></div></html>`,
      `<!doctype html><html lang="en"><body></body><article>${paragraph}${paragraph}</article></html>`,
    ]) {
      const result = await extractArticle(html, PAGE_URL);
      expect(result.kind).toBe("article");
    }
  });

  test("turns headings, lists, tables, code, quotes and links into Markdown", async () => {
    const html = page(`<article>
      <h1>A careful guide to notes</h1>
      <p class="byline">By Ada Writer</p>
      <p style="color:red">${sentences(12)}</p>
      <h2>Lists</h2>
      <ul><li>first <strong>bold</strong> point</li><li>second <em>soft</em> point</li></ul>
      <ol start="3"><li>third</li><li>fourth</li></ol>
      <p>${sentences(12, 20)} Read <a href="/related">the related post</a>, not <a href="javascript:alert(1)">this</a>.</p>
      <h3>Table</h3>
      <table><tr><td>Name</td><td>Pipe | cell</td></tr><tr><td>Ada</td><td>1</td></tr></table>
      <pre><code class="language-ts">const answer = 42;
console.log(answer);</code></pre>
      <blockquote><p>Quoted wisdom stays quoted.</p></blockquote>
      <p><del>struck</del> words</p>
      <script>alert("no")</script>
      <p>${sentences(10, 40)}</p>
    </article>`);
    const result = await extractArticle(html, PAGE_URL, { encodeImage });
    if (result.kind !== "article") {
      throw new Error(`expected an article, got ${result.kind}`);
    }
    const { markdown } = result;
    expect(markdown).toContain("## Lists");
    expect(markdown).toContain("- first **bold** point");
    expect(markdown).toContain("- second _soft_ point");
    expect(markdown).toContain("3. third\n4. fourth");
    expect(markdown).toContain("### Table");
    expect(markdown).toContain(
      "| Name | Pipe \\| cell |\n| --- | --- |\n| Ada | 1 |"
    );
    expect(markdown).toContain(
      "```ts\nconst answer = 42;\nconsole.log(answer);\n```"
    );
    expect(markdown).toContain("> Quoted wisdom stays quoted.");
    expect(markdown).toContain("~~struck~~ words");
    expect(markdown).toContain(
      "[the related post](https://site.example/related)"
    );
    expect(markdown).not.toContain("javascript:");
    expect(markdown).not.toContain("alert");
    expect(markdown).not.toContain("Home");
    expect(markdown).not.toContain("Copyright");
    expect(result.byline).toBe("By Ada Writer");
    expect(result.lang).toBe("en");
    expect(result.truncated).toBe(false);
    expect(result.wordCount).toBeGreaterThan(300);
    expect(result.images).toEqual([]);
  });

  test("keeps a task list's checked and open items, and drops other form controls", async () => {
    const html = page(
      `<article><h1>Packing</h1><p>${sentences(20)}</p><ul><li><input type="checkbox" checked disabled> Pack the tent</li><li><input type="checkbox" disabled> Buy the stove</li><li>&#xE000; \uE001 Check the map</li></ul><p><input type="text" value="search"> ${sentences(4, 20)}</p></article>`
    );
    const result = await extractArticle(html, PAGE_URL, {});
    if (result.kind !== "article") {
      throw new Error("expected an article");
    }
    expect(result.markdown).toContain("- [x] Pack the tent");
    expect(result.markdown).toContain("- [ ] Buy the stove");
    expect(result.markdown).toContain("- \uE000 \uE001 Check the map");
    expect(result.markdown).not.toMatch(/teaktask|search/u);
  });

  test("leaves out the page's own controls: wiki [edit] links and Read more / Show less toggles", async () => {
    const html = page(
      `<article><h1>Bauhaus</h1>
      <div class="mw-heading mw-heading2"><h2 id="History">History</h2><span class="mw-editsection"><span class="mw-editsection-bracket">[</span><a href="/w/index.php?title=Bauhaus&amp;action=edit&amp;section=1">edit</a><span class="mw-editsection-bracket">]</span></span></div>
      <p>${sentences(12)}</p>
      <h2>Legacy <a href="/w/index.php?title=Bauhaus&amp;veaction=edit&amp;section=2">edit source</a></h2>
      <p>${sentences(8, 20)} <span class="toggle">Read more</span><span class="toggle">Show less</span></p>
      <div class="summary"><label for="toggle-summary">Read more</label> <label for="toggle-summary">Show less</label></div>
      <p>${sentences(8, 40)} <span role="button" tabindex="0">Show more ›</span></p>
      <p>Readers who read more books keep more notes. ${sentences(4, 60)}</p>
      <p><a href="/w/Edit_(film)">Edit</a> is a film. You can <a href="/more">read more</a> here, or <a href="/expand">Expand</a> the list.</p>
    </article>`
    );
    const result = await extractArticle(html, PAGE_URL);
    if (result.kind !== "article") {
      throw new Error("expected an article");
    }
    expect(result.markdown).toContain("## History");
    expect(result.markdown).toMatch(/## Legacy\n/u);
    expect(result.markdown).not.toMatch(/\[edit\]|edit source|action=edit/u);
    expect(result.markdown).not.toMatch(
      /Show less|Show more|Read more(?! books)/u
    );
    expect(result.markdown).toContain(
      "Readers who read more books keep more notes."
    );
    expect(result.markdown).toContain(
      "[Edit](https://site.example/w/Edit_\\(film\\)) is a film. You can [read more](https://site.example/more) here, or [Expand](https://site.example/expand) the list."
    );
  });

  test("numbers the archive's images in reading order as teak-image:<n>, with captions", async () => {
    const first = pngDataUri("first");
    const second = pngDataUri("second");
    const html = page(`<article><h1>Images</h1><p>${sentences(15)}</p>
      <figure><img src="${first}" alt="A [quiet] cat" srcset="x.png 2x"><figcaption>The "first" cat</figcaption></figure>
      <p>${sentences(15, 20)}</p>
      <img src="https://cdn.site.example/remote.png" alt="remote">
      <img src="${second}" alt="">
      <img src="${first}" alt="again">
      <img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" alt="placeholder">
      <p>${sentences(10, 40)}</p></article>`);
    const result = await extractArticle(html, PAGE_URL, { encodeImage });
    if (result.kind !== "article") {
      throw new Error("expected an article");
    }
    expect(result.markdown).toContain(
      '![A quiet cat](teak-image:0 "The \\"first\\" cat")'
    );
    expect(result.markdown).toContain("![](teak-image:1)");
    expect(result.markdown).toContain("![again](teak-image:0)");
    expect(result.markdown).not.toContain("remote");
    expect(result.markdown).not.toContain("svg");
    expect(result.markdown).not.toContain("teak-candidate");
    expect(result.images).toHaveLength(2);
    expect(result.images.map((image) => decoded(image.base64))).toEqual([
      "PNG-first-PNG-fi",
      "PNG-second-PNG-s",
    ]);
    expect(result.images[0]).toMatchObject({
      bytes: 16,
      contentType: "image/webp",
    });
  });

  test("keeps at most 20 images and takes out the ones that can't be encoded", async () => {
    const images = Array.from(
      { length: 25 },
      (_, index) =>
        `<p><img src="${pngDataUri(`image${index}`)}" alt="i${index}"></p><p>${sentences(2, index * 10)}</p>`
    ).join("");
    const html = page(
      `<article><h1>Gallery</h1><p>${sentences(20)}</p>${images}</article>`
    );
    const failing: EncodeArticleImage = (image) => {
      const text = new TextDecoder().decode(image.body.slice(0, 12));
      return text.startsWith("PNG-image3-")
        ? Promise.resolve(null)
        : encodeImage(image);
    };
    const result = await extractArticle(html, PAGE_URL, {
      encodeImage: failing,
    });
    if (result.kind !== "article") {
      throw new Error("expected an article");
    }
    expect(result.images).toHaveLength(19);
    expect(result.markdown).not.toContain("![i3]");
    expect(result.markdown).not.toContain("![i20]");
    expect(result.markdown).toContain("![i19](teak-image:18)");
    const references = [...result.markdown.matchAll(/teak-image:(\d+)/gu)].map(
      (match) => Number(match[1])
    );
    expect(references).toEqual(Array.from({ length: 19 }, (_, index) => index));
  });

  test("an article without an encoder keeps its text and leaves its images out", async () => {
    const html = page(
      `<article><h1>Text</h1><p>${sentences(20)}</p><img src="${pngDataUri("x")}" alt="x"><p>${sentences(20, 30)}</p></article>`
    );
    const result = await extractArticle(html, PAGE_URL);
    expect(result).toMatchObject({ images: [], kind: "article" });
    expect(result.kind === "article" && result.markdown).not.toContain("![");
  });

  test("a page with under 120 words is not an article", async () => {
    const result = await extractArticle(
      page(`<article><h1>Short</h1><p>${sentences(10)}</p></article>`),
      PAGE_URL
    );
    expect(result).toEqual({
      kind: "none",
      reason: "too_short",
      wordCount: expect.any(Number),
    });
    expect(result.kind === "none" && result.wordCount).toBeLessThan(120);
  });

  test("a product page Readability doesn't think readable needs 300 words", async () => {
    const cells = (from: number) =>
      Array.from(
        { length: 12 },
        (_, index) =>
          `<div class="tile"><span>Item ${from + index}</span> <span>price twelve dollars only today</span></div>`
      ).join("");
    const shop = page(
      `<div class="grid">${cells(0)}</div><div class="grid">${cells(20)}</div><div class="grid">${cells(40)}</div>`
    );
    const result = await extractArticle(shop, PAGE_URL);
    expect(result.kind).toBe("none");
  });

  test("an empty page is not an article", async () => {
    const result = await extractArticle("<html><body></body></html>", PAGE_URL);
    expect(result.kind).toBe("none");
  });

  test("a right-to-left article keeps its direction and language", async () => {
    const arabic = Array.from(
      { length: 40 },
      (_, index) =>
        `هذه الجملة رقم ${index} تشرح كيف يحتفظ القراء بملاحظاتهم بعناية.`
    ).join(" ");
    const result = await extractArticle(
      page(
        `<article><h1>مقالة</h1><p>${arabic}</p><p>${arabic}</p></article>`,
        'lang="ar" dir="rtl"'
      ),
      PAGE_URL
    );
    expect(result).toMatchObject({ dir: "rtl", kind: "article", lang: "ar" });
  });

  test("Japanese text counts its words without spaces between them", async () => {
    const japanese =
      "読書は心を豊かにし、新しい考えを与えてくれる大切な習慣です。".repeat(30);
    const result = await extractArticle(
      page(
        `<article><h1>読書について</h1><p>${japanese}</p><p>${japanese}</p></article>`,
        'lang="ja"'
      ),
      PAGE_URL
    );
    if (result.kind !== "article") {
      throw new Error("expected an article");
    }
    expect(result.lang).toBe("ja");
    expect(result.markdown).toContain("読書は心を豊かにし");
    expect(result.wordCount).toBeGreaterThan(500);
  });

  test("a text-only copy reads as its text, without its 'Text-only copy' header", async () => {
    const textOnly = `<!doctype html><html lang="en"><head><title>Long page</title></head><body><header><p>Text-only copy</p></header><h1 dir="auto">Long page</h1><p dir="auto">${sentences(20)}</p><p dir="auto">${sentences(20, 30)}</p></body></html>`;
    const result = await extractArticle(textOnly, PAGE_URL);
    expect(result.kind).toBe("article");
    expect(result.kind === "article" && result.markdown).not.toContain(
      "Text-only copy"
    );
  });

  test("Markdown past the cap is cut at a paragraph and marked truncated", async () => {
    const paragraphs = Array.from(
      { length: 30 },
      (_, index) => `<p>${sentences(8, index * 10)}</p>`
    ).join("");
    const result = await extractArticle(
      page(`<article><h1>Long</h1>${paragraphs}</article>`),
      PAGE_URL,
      { maxMarkdownChars: 4000 }
    );
    if (result.kind !== "article") {
      throw new Error("expected an article");
    }
    expect(result.truncated).toBe(true);
    expect(result.markdown.length).toBeLessThanOrEqual(4000);
    expect(result.markdown.endsWith("notes.")).toBe(true);
  });
});

describe("extract-article op", () => {
  test("reads the saved copy from storage and writes nothing", async () => {
    const bucket = new FakeBucket();
    const html = page(
      `<article><h1>Stored</h1><p>${sentences(20)}</p><p>${sentences(20, 30)}</p></article>`
    );
    bucket.objects.set(ARCHIVE_KEY, {
      bytes: new TextEncoder().encode(html),
    } as never);
    const env = { BUCKET: bucket as unknown as R2Bucket };
    const result = await runExtractArticle(
      env,
      parseExtractArticleParams({ archiveKey: ARCHIVE_KEY, pageUrl: PAGE_URL })
    );
    expect(result.kind).toBe("article");
    expect(bucket.puts).toEqual([]);
    expect(
      await runExtractArticle(env, {
        archiveKey: "users/u1/cards/c1/page-archive/gone-archive.html",
        pageUrl: PAGE_URL,
      })
    ).toEqual({ kind: "missing" });
  });

  test("refuses keys that aren't a saved copy, and pages that aren't http(s)", () => {
    for (const params of [
      { archiveKey: "users/u1/cards/c1/file/x.html", pageUrl: PAGE_URL },
      { archiveKey: "../etc/passwd", pageUrl: PAGE_URL },
      { archiveKey: ARCHIVE_KEY, pageUrl: "javascript:alert(1)" },
      { archiveKey: ARCHIVE_KEY },
    ]) {
      expect(() => parseExtractArticleParams(params)).toThrow();
    }
  });
});
