import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
}));

const { ARTICLE_READER_ATTRIBUTE, ArticleReader, articleReaderState } =
  await import("../ArticleReader");
const { requestFileTextPreview } = await import("../fileTextPreviewCache");

const TEXT_KEY = "users/u/cards/card_1/article-text/a.md";
const IMAGE_KEY = "users/u/cards/card_1/article-image/b.webp";
const IMAGE_URL =
  "https://files.test/users/u/cards/card_1/article-image/b.webp?sig=1";

const MARKDOWN = [
  "# Gardens in spring",
  "",
  "Plant the [marigolds](https://example.com/marigolds) first.",
  "",
  '![A rose](teak-image:0 "The first rose")',
  "",
  "![](teak-image:99)",
  "",
  "<script>alert(1)</script>",
  "",
  '<iframe src="https://evil.example"></iframe>',
  "",
  "[click me](javascript:alert(2)) and ![x](javascript:alert(3))",
  "",
  "| Plant | Month |",
  "| --- | --- |",
  "| Rose | May |",
  "",
  "## Care",
  "",
  "Water weekly.",
].join("\n");

/** Puts the Markdown in the reader's text cache, as a fetch would. */
const seed = async (key: string, markdown: string) => {
  await requestFileTextPreview({
    cacheKey: key,
    fetchImpl: (() =>
      Promise.resolve(new Response(markdown))) as unknown as typeof fetch,
    fileUrl: "https://files.test/article.md",
  });
};

const card = (fields: Record<string, unknown> = {}) =>
  ({
    _creationTime: 0,
    _id: "card_1",
    article: {
      byline: "Ada Writer",
      extractedAt: 2,
      imageKeys: [IMAGE_KEY],
      lang: "en",
      readingMinutes: 8,
      status: "ready",
      textKey: TEXT_KEY,
      title: "Gardens in spring",
      wordCount: 1800,
    },
    articleImageUrls: [IMAGE_URL],
    articleUrl: "https://files.test/article.md",
    content: "https://www.example.com/gardens",
    createdAt: Date.UTC(2026, 9, 19, 12),
    pageArchive: {
      bytes: 1,
      capturedAt: Date.UTC(2026, 9, 19, 12),
      kind: "full",
      source: "server",
      sourceUrl: "https://www.example.com/gardens",
      storageKey: "users/u/cards/card_1/page-archive/r1-archive.html",
    },
    type: "link",
    updatedAt: 0,
    url: "https://www.example.com/gardens",
    userId: "u",
    ...fields,
  }) as never;

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<ArticleReader card={card()} {...props} />);

describe("ArticleReader", () => {
  test("shows the site, byline and reading time, then the title once", async () => {
    await seed(TEXT_KEY, MARKDOWN);
    const html = render();

    expect(html).toContain(`${ARTICLE_READER_ATTRIBUTE}="card_1"`);
    // The title and the body take their own direction, never the header's.
    expect(html).not.toMatch(/<article[^>]*\sdir=/u);
    expect(html).toMatch(/<h1[^>]*\sdir="auto"/u);
    expect(html).toMatch(/<div[^>]*\sdir="auto"[^>]*data-article-body/u);
    expect(html).toContain('lang="en"');
    expect(html).toContain(">example.com<");
    expect(html).toContain(">Ada Writer<");
    expect(html).toContain(">8 min read<");
    // The Markdown's own opening heading repeats the title: only one stays.
    expect(html.match(/Gardens in spring/gu)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Gardens in spring<\/h1>/u);
    expect(html).toContain("<h2>Care</h2>");
  });

  test("maps teak-image references to signed URLs, with captions, and drops unknown ones", async () => {
    await seed(TEXT_KEY, MARKDOWN);
    const html = render();

    expect(html).toContain(`src="${IMAGE_URL}"`);
    expect(html).toContain('alt="A rose"');
    expect(html).toContain(">The first rose<");
    expect(html).not.toContain("teak-image:");
    expect(html.match(/<img /gu)?.filter(Boolean).length).toBe(
      // The favicon and the one image the article has.
      2
    );
  });

  test("strips scripts, frames and javascript: links and images", async () => {
    await seed(TEXT_KEY, MARKDOWN);
    const html = render();

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click me");
  });

  test("opens every article link in a new tab, and scrolls wide tables", async () => {
    await seed(TEXT_KEY, MARKDOWN);
    const html = render();

    expect(html).toContain(
      '<a href="https://example.com/marigolds" rel="noopener noreferrer" target="_blank">marigolds</a>'
    );
    expect(html).toContain('<div class="reader-table"><table>');
  });

  test("ends with where it was saved from and a link to the original", async () => {
    await seed(TEXT_KEY, MARKDOWN);
    const html = render();

    expect(html).toContain("Saved from example.com · Oct 19, 2026 · ");
    expect(html).toMatch(
      /<a [^>]*href="https:\/\/www\.example\.com\/gardens"[^>]*target="_blank"[^>]*>Open original ↗<\/a>/u
    );
    expect(html).not.toContain("Article shortened to fit.");
  });

  test("a shortened article says so above the link", async () => {
    await seed(TEXT_KEY, MARKDOWN);
    const html = renderToStaticMarkup(
      <ArticleReader
        card={card({
          article: {
            extractedAt: 2,
            imageKeys: [],
            readingMinutes: 0,
            status: "ready",
            textKey: TEXT_KEY,
            truncated: true,
            wordCount: 120,
          },
        })}
        title="Fallback title"
      />
    );
    expect(html).toContain("Article shortened to fit.");
    // At least one minute, and the link's title when the article has none.
    expect(html).toContain(">1 min read<");
    expect(html).toMatch(/<h1[^>]*>Fallback title<\/h1>/u);
  });

  test("a loading article shows a skeleton at reading width", () => {
    const html = renderToStaticMarkup(
      <ArticleReader
        card={card({
          article: {
            extractedAt: 2,
            imageKeys: [],
            readingMinutes: 3,
            status: "ready",
            textKey: "users/u/cards/card_1/article-text/not-loaded.md",
            wordCount: 640,
          },
        })}
      />
    );
    expect(html).toContain('data-slot="skeleton"');
    expect(html).toContain("max-w-[68ch]");
  });

  test("an article still being prepared, and one that failed with Try again", () => {
    const preparing = renderToStaticMarkup(
      <ArticleReader
        card={card({
          article: undefined,
          processingStatus: { article: { status: "in_progress" } },
        })}
      />
    );
    expect(preparing).toContain("Preparing the article…");

    const failed = renderToStaticMarkup(
      <ArticleReader
        card={card({
          article: undefined,
          processingStatus: { article: { status: "failed" } },
        })}
        onRetry={() => undefined}
      />
    );
    expect(failed).toContain("Couldn&#x27;t prepare this article.");
    expect(failed).toContain(">Try again<");
  });
});

describe("articleReaderState", () => {
  test.each([
    [{ article: { status: "ready" } }, "ready"],
    [{ processingStatus: { article: { status: "pending" } } }, "preparing"],
    [{ processingStatus: { article: { status: "in_progress" } } }, "preparing"],
    [{ processingStatus: { article: { status: "failed" } } }, "failed"],
    [{ article: { status: "none" } }, "none"],
    [{ processingStatus: { article: { status: "completed" } } }, "none"],
    [{}, "none"],
  ])("%o is %s", (fields, kind) => {
    expect(articleReaderState({ type: "link", ...fields } as never).kind).toBe(
      kind as never
    );
  });

  test("only links have a Read tab", () => {
    expect(
      articleReaderState({
        article: { status: "ready" },
        type: "document",
      } as never).kind
    ).toBe("none");
  });
});
