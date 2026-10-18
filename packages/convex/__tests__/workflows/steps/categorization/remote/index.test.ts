import { describe, expect, test } from "bun:test";
import { resolveLinkCategory } from "../../../../../shared";
import { buildRawSelectorMap } from "../../../../../workflows/steps/categorization/enrichment";
import {
  fetchRemoteDetails,
  MAX_LINK_FACTS,
  type RemoteDetails,
  remoteSourceFor,
} from "../../../../../workflows/steps/categorization/remote/index";
import {
  type CategorizationContextCard,
  classifyLinkCategory,
  enrichLinkCategory,
  remoteLookupInput,
} from "../../../../../workflows/steps/categorization/rules";
import { socialFetch } from "../../../../helpers/socialFetch.test-utils";

const ARTICLE = "https://en.wikipedia.org/wiki/Ada_Lovelace";
const BOOK = "https://www.goodreads.com/book/show/6693";

const linkCard = (
  url: string,
  fields: Partial<CategorizationContextCard> = {}
): CategorizationContextCard => ({
  _id: "card_1",
  type: "link",
  url,
  metadata: { linkPreview: { status: "success", title: "A page" } },
  ...fields,
});

const isbnPreview = (isbn: string) => ({
  linkPreview: {
    status: "success",
    raw: [
      {
        selector: "meta[property='books:isbn']",
        results: [{ attributes: [{ name: "content", value: isbn }] }],
      },
    ],
  },
});

const wikipedia: RemoteDetails = {
  source: "wikipedia",
  facts: [
    { label: "About", value: "English mathematician" },
    { label: "Updated", value: "Oct 15, 2026" },
  ],
  imageUrl: "https://upload.wikimedia.org/lead.png",
  summary: "Ada was a mathematician.",
};

describe("link rules", () => {
  test("a Wikipedia article is an article Wikipedia describes", () => {
    expect(resolveLinkCategory(ARTICLE)).toMatchObject({
      category: "article",
      provider: "wikipedia",
      reason: "domain_rule",
    });
    expect(
      resolveLinkCategory(
        "https://ja.m.wikipedia.org/wiki/%E5%AF%8C%E5%A3%AB%E5%B1%B1"
      )
    ).toMatchObject({ category: "article", provider: "wikipedia" });
    expect(resolveLinkCategory("https://www.wikipedia.org/")).not.toMatchObject(
      { provider: "wikipedia" }
    );
  });

  test("an arXiv link is research arXiv describes", () => {
    expect(
      resolveLinkCategory("https://arxiv.org/abs/1706.03762")
    ).toMatchObject({ category: "research", provider: "arxiv" });
  });
});

describe("remoteSourceFor", () => {
  const sourceFor = (
    url: string,
    fields?: Partial<CategorizationContextCard>
  ) => {
    const card = linkCard(url, fields);
    const classification = classifyLinkCategory(card);
    if (!classification) {
      throw new Error("unclassified");
    }
    return remoteSourceFor(remoteLookupInput(card, classification, null));
  };

  test.each([
    [ARTICLE, "wikipedia"],
    ["https://arxiv.org/pdf/1706.03762", "arxiv"],
    ["https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3", "spotify"],
    ["https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ", "spotify"],
    ["https://music.apple.com/us/album/x/1700000000", "apple_music"],
    ["https://podcasts.apple.com/us/podcast/x/id1", null],
    ["https://example.com/blog/post", null],
  ])("%s asks %s", (url: string, source: string | null) => {
    expect(sourceFor(url)).toBe(source as never);
  });

  test("a book asks Open Library only with a valid ISBN", () => {
    expect(sourceFor(BOOK, { metadata: isbnPreview("9780140328721") })).toBe(
      "open_library"
    );
    expect(
      sourceFor(BOOK, { metadata: isbnPreview("9780140328722") })
    ).toBeNull();
    expect(sourceFor(BOOK)).toBeNull();
  });

  test("an Apple Books page with an ISBN asks Open Library", () => {
    const input = {
      entities: [],
      provider: "apple",
      rawMap: buildRawSelectorMap(isbnPreview("9780140328721").linkPreview.raw),
      sourceUrl: "https://books.apple.com/us/book/x/id1",
    };

    expect(remoteSourceFor({ ...input, category: "book" })).toBe(
      "open_library"
    );
    expect(remoteSourceFor({ ...input, category: "music" })).toBe(
      "apple_music"
    );
  });

  test("an Amazon book asks Open Library by the ISBN in its link", () => {
    expect(
      sourceFor("https://www.amazon.com/Fantastic-Mr-Fox/dp/0140328726/")
    ).toBe("open_library");
    expect(sourceFor("https://www.amazon.com/dp/0140328727")).toBeNull();
    expect(sourceFor("https://www.amazon.com/dp/B08N5WRWNW")).toBeNull();
    expect(sourceFor("https://www.amazon.com/gp/product/0140328726")).toBe(
      "open_library"
    );
  });
});

describe("fetchRemoteDetails", () => {
  test("a site that throws gives nothing", async () => {
    const { deps } = socialFetch(() => {
      throw new Error("socket hang up");
    });

    expect(
      await fetchRemoteDetails(
        {
          category: "article",
          entities: [],
          provider: "wikipedia",
          rawMap: buildRawSelectorMap([]),
          sourceUrl: ARTICLE,
        },
        deps
      )
    ).toBeNull();
  });

  test("a link no site describes asks nothing", async () => {
    const { deps, requests } = socialFetch(() => undefined);

    expect(
      await fetchRemoteDetails(
        {
          category: "article",
          entities: [],
          provider: "medium",
          rawMap: buildRawSelectorMap([]),
          sourceUrl: "https://medium.com/@a/b",
        },
        deps
      )
    ).toBeNull();
    expect(requests).toEqual([]);
  });
});

describe("enrichLinkCategory with site details", () => {
  const article = {
    category: "article",
    confidence: 0.98,
    providerHint: "wikipedia",
  } as const;

  test("adds the site's facts and image and keeps its summary out of the facts", () => {
    const result = enrichLinkCategory(linkCard(ARTICLE), article, {
      remote: wikipedia,
    });

    expect(result.facts).toEqual(wikipedia.facts);
    expect(result.imageUrl).toBe(wikipedia.imageUrl);
    expect(result.raw?.remote).toEqual({ ...wikipedia, sourceUrl: ARTICLE });
    expect(result.pdfUrl).toBeUndefined();
  });

  test("the page's own facts and image win over the site's", () => {
    const card = linkCard(ARTICLE, {
      metadata: {
        linkPreview: {
          status: "success",
          imageUrl: "https://upload.wikimedia.org/og.png",
        },
      },
    });

    const result = enrichLinkCategory(card, article, {
      remote: wikipedia,
      structuredData: {
        entities: [
          {
            "@type": "Article",
            datePublished: "2001-01-01",
            dateModified: "2026-10-01",
          },
        ],
      },
    });

    expect(result.facts).toEqual([
      { label: "Published", value: "Jan 1, 2001" },
      { label: "Updated", value: "Oct 1, 2026" },
      { label: "About", value: "English mathematician" },
    ]);
    expect(result.imageUrl).toBe("https://upload.wikimedia.org/og.png");
  });

  test("site facts fill only the room left of eight", () => {
    const remote: RemoteDetails = {
      source: "open_library",
      facts: [
        { label: "Pages", value: "96" },
        { label: "Publisher", value: "Puffin" },
        { label: "ISBN", value: "9780140328721" },
      ],
    };
    const book = {
      "@type": "Book",
      author: "Roald Dahl",
      aggregateRating: { ratingValue: 4.1, ratingCount: 10 },
      numberOfPages: 96,
      datePublished: "1970-01-01",
    };
    const card = linkCard(BOOK, {
      metadata: {
        linkPreview: {
          status: "success",
          raw: [
            {
              selector: "meta[property='books:rating:average']",
              results: [{ attributes: [{ name: "content", value: "4.1" }] }],
            },
            {
              selector: "meta[property='books:rating:count']",
              results: [{ attributes: [{ name: "content", value: "10" }] }],
            },
          ],
        },
      },
    });

    const result = enrichLinkCategory(
      card,
      { category: "book", confidence: 0.98, providerHint: "goodreads" },
      { remote, structuredData: { entities: [book] } }
    );

    expect(result.facts).toHaveLength(MAX_LINK_FACTS);
    expect(result.facts?.map((fact) => fact.label)).not.toContain("Pages");
    expect(result.facts?.map((fact) => fact.label)).toContain("Publisher");
  });

  test("a later pass that couldn't ask the site keeps what it said", () => {
    const first = enrichLinkCategory(linkCard(ARTICLE), article, {
      remote: wikipedia,
    });
    const card = linkCard(ARTICLE, {
      metadata: {
        linkPreview: { status: "success" },
        linkCategory: first,
      },
    });

    const second = enrichLinkCategory(card, article, { remote: null });

    expect(second.facts).toEqual(wikipedia.facts);
    expect(second.raw?.remote).toEqual(first.raw?.remote);
  });

  test("details stored for another URL are dropped", () => {
    const first = enrichLinkCategory(linkCard(ARTICLE), article, {
      remote: wikipedia,
    });
    const card = linkCard("https://en.wikipedia.org/wiki/Charles_Babbage", {
      metadata: { linkPreview: { status: "success" }, linkCategory: first },
    });

    const second = enrichLinkCategory(card, article, {});

    expect(second.facts).toBeUndefined();
    expect(second.raw?.remote).toBeUndefined();
  });

  test("a book's stored ISBN isn't used for another URL", () => {
    const book = {
      category: "book",
      confidence: 0.98,
      providerHint: "goodreads",
    } as const;
    const stored = (url: string) =>
      linkCard(url, {
        metadata: {
          linkPreview: { status: "success" },
          linkCategory: {
            category: "book",
            fetchedAt: 1,
            raw: { structured: { "@type": "Book", isbn: "9780140328721" } },
            sourceUrl: BOOK,
          },
        },
      });
    const sourceFor = (url: string) =>
      remoteSourceFor(remoteLookupInput(stored(url), book, null));

    expect(sourceFor(BOOK)).toBe("open_library");
    expect(sourceFor("https://www.goodreads.com/book/show/1")).toBeNull();
  });

  test("an arXiv paper offers its PDF, and loses it once withdrawn", () => {
    const url = "https://arxiv.org/abs/1706.03762";
    const research = {
      category: "research",
      confidence: 0.98,
      providerHint: "arxiv",
    } as const;
    const paper: RemoteDetails = {
      source: "arxiv",
      facts: [{ label: "Subject", value: "cs.CL" }],
      pdfUrl: "https://arxiv.org/pdf/1706.03762",
    };

    const first = enrichLinkCategory(linkCard(url), research, {
      remote: paper,
    });
    const withdrawn = enrichLinkCategory(
      linkCard(url, {
        metadata: { linkPreview: { status: "success" }, linkCategory: first },
      }),
      research,
      { remote: { ...paper, pdfUrl: undefined } }
    );

    expect(first.pdfUrl).toBe("https://arxiv.org/pdf/1706.03762");
    expect(withdrawn.pdfUrl).toBeUndefined();
  });
});
