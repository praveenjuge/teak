import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { normalizeReaderText } from "@teak/convex/shared/highlights/anchor";
import { markdownToReaderText } from "@teak/convex/shared/highlights/readerText";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

// The reader's text cache reads a Response's stream, which needs Bun's own
// streams: every article is put in it before happy-dom replaces them.
const { requestFileTextPreview } = await import("../fileTextPreviewCache");
const seed = async (key: string, markdown: string) => {
  await requestFileTextPreview({
    cacheKey: key,
    fetchImpl: (() =>
      Promise.resolve(new Response(markdown))) as unknown as typeof fetch,
    fileUrl: "https://files.test/article.md",
  });
};
const keyOf = (name: string) =>
  `users/u/cards/card_1/article-text/r1-${name.replace(/\W/gu, "")}.md`;

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
}));

const { indexBodyText, placeHighlights, rangeOfSpan, spanOfRange } =
  await import("../highlightDom");

const IMAGE_URL = "https://files.test/rose.webp?sig=1";

const card = (textKey: string, fields: Record<string, unknown> = {}) =>
  ({
    _creationTime: 0,
    _id: "card_1",
    article: {
      extractedAt: 2,
      imageKeys: ["users/u/cards/card_1/article-image/r1-b.webp"],
      readingMinutes: 3,
      status: "ready",
      textKey,
      title: "Gardens in spring",
      wordCount: 600,
    },
    articleImageUrls: [IMAGE_URL],
    articleUrl: "https://files.test/article.md",
    content: "https://example.com/gardens",
    createdAt: 1,
    type: "link",
    updatedAt: 1,
    url: "https://example.com/gardens",
    userId: "u",
    ...fields,
  }) as never;

const FIXTURES: Record<string, string> = {
  "headings, lists, a quote and a table": [
    "# Gardens in spring",
    "",
    "Plant the **marigolds** _first_, then [water](https://example.com).",
    "",
    "- One",
    "- Two with `code`",
    "  - Nested",
    "",
    "1. First",
    "2. Second",
    "",
    "> A quote",
    "> on two lines",
    "",
    "| Plant | Month |",
    "| --- | ---: |",
    "| Rose | May |",
    "",
    "## Care",
    "",
    "Water weekly.  ",
    "Hard break above.",
  ].join("\n"),
  "images, captions, code and raw HTML": [
    'Before ![A rose](teak-image:0 "The first rose") after.',
    "",
    "![gone](teak-image:9)",
    "",
    "```js",
    "const x = 1;",
    "",
    "  return x;",
    "```",
    "",
    "<div>raw <b>html</b></div>",
    "",
    "Text with <span>inline</span> tags.",
  ].join("\n"),
  "footnotes, tasks and strikethrough": [
    "A claim[^1] and ~~an old one~~.",
    "",
    "- [x] Done",
    "- [ ] Not yet",
    "",
    "[^1]: The source.",
  ].join("\n"),
  "right-to-left and Japanese": [
    "## الحديقة",
    "",
    "الحديقة جميلة في الربيع.",
    "",
    "庭の話。春にはマリーゴールドを植えます。",
  ].join("\n"),
};

const SELECT_MARKDOWN = [
  "# Gardens in spring",
  "",
  "Plant the **marigolds** first.",
  "",
  "Water them in the morning.",
].join("\n");

for (const [name, markdown] of Object.entries(FIXTURES)) {
  await seed(keyOf(name), markdown);
}
await seed(keyOf("select"), SELECT_MARKDOWN);

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ARTICLE_BODY_ATTRIBUTE, ArticleReader } = await import(
  "../ArticleReader"
);

describe("the server's reader text", () => {
  test.each(Object.entries(FIXTURES))(
    "is the reader's own text for %s",
    (name, markdown) => {
      const key = keyOf(name);
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<ArticleReader card={card(key)} />);
      const body = host.querySelector(`[${ARTICLE_BODY_ATTRIBUTE}]`);
      expect(body).not.toBeNull();
      expect(normalizeReaderText(body?.textContent ?? "")).toBe(
        markdownToReaderText(markdown, {
          imageCount: 1,
          title: "Gardens in spring",
        })
      );
    }
  );
});

describe("selecting in the reader", () => {
  let root: Root | undefined;
  afterEach(async () => {
    await act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
  });

  const mount = async (create = mock(async () => true)) => {
    const key = keyOf("select");
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(() => {
      root?.render(
        <ArticleReader
          card={card(key)}
          highlights={{
            create,
            highlights: [],
            isFull: false,
            remove: mock(async () => undefined),
            updateNote: mock(async () => undefined),
          }}
        />
      );
    });
    const body = host.querySelector(
      `[${ARTICLE_BODY_ATTRIBUTE}]`
    ) as HTMLElement;
    return { body, create, host };
  };

  const select = async (
    from: Node,
    fromOffset: number,
    to: Node,
    toOffset: number
  ) => {
    const range = document.createRange();
    range.setStart(from, fromOffset);
    range.setEnd(to, toOffset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    return range;
  };

  test("offsets of a selection across bold text map to its plain-text range", async () => {
    const { body } = await mount();
    const index = indexBodyText(body);
    const paragraph = body.querySelector("p") as HTMLElement;
    const range = document.createRange();
    range.setStart(paragraph.firstChild as Text, "Plant the ".length);
    range.setEnd(paragraph.lastChild as Text, " first".length);
    const span = spanOfRange(index, range);
    expect(span?.quote).toBe("marigolds first");
    expect(index.map.text.slice(span?.start, span?.end)).toBe(
      "marigolds first"
    );
    const back = span ? rangeOfSpan(index, span.start, span.end) : null;
    expect(back?.toString()).toBe("marigolds first");
  });

  test("a selection inside the body shows the Highlight button, which highlights it", async () => {
    const { body, create, host } = await mount();
    const second = body.querySelectorAll("p")[1] as HTMLElement;
    const text = second.firstChild as Text;
    await select(text, "Water ".length, text, "Water them".length);

    const button = [...host.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Highlight")
    );
    expect(button).toBeDefined();
    await act(() => {
      button?.click();
    });
    expect(create).toHaveBeenCalledTimes(1);
    const input = create.mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >;
    // The offsets belong to the article the reader shows.
    expect(input).toMatchObject({ articleKey: keyOf("select"), quote: "them" });
    const index = indexBodyText(body);
    expect(
      index.map.text.slice(input.start as number, input.end as number)
    ).toBe("them");
    expect(input.prefix).toBe(
      index.map.text.slice(0, input.start as number).slice(-32)
    );
  });

  test("a selection of the title alone shows no button", async () => {
    const { host } = await mount();
    const title = host.querySelector("h1") as HTMLElement;
    await select(title.firstChild as Text, 0, title.firstChild as Text, 7);
    const button = [...host.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Highlight")
    );
    expect(button).toBeUndefined();
  });
});

describe("placeHighlights", () => {
  test("finds a highlight again by its quote when its offsets went stale", () => {
    const text = "One two three. Four five six.";
    expect(
      placeHighlights(text, [
        { _id: "a", quote: "Four five", start: 0, end: 9 },
        { _id: "b", quote: "Gone", start: 0, end: 4 },
        { _id: "c", quote: "One", unanchored: true },
      ])
    ).toEqual([{ id: "a", start: 15, end: 24 }]);
  });
});
