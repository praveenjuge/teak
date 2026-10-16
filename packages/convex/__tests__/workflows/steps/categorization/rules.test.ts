import { describe, expect, test } from "bun:test";
import type {
  LinkCategory,
  LinkCategoryMetadata,
} from "../../../../shared/linkCategories";
import {
  type CategorizationContextCard,
  classifyLinkCategory,
  enrichLinkCategory,
  projectCategorizationSnapshot,
} from "../../../../workflows/steps/categorization/rules";

// The pure categorization rules the Files Worker's step runs.

const linkCard = (
  fields: Partial<CategorizationContextCard>
): CategorizationContextCard => ({ _id: "card_1", type: "link", ...fields });

const factValue = (result: LinkCategoryMetadata, label: string) =>
  result.facts?.find((fact) => fact.label === label)?.value;

describe("classifyLinkCategory", () => {
  test("classifies correctly", async () => {
    const card = linkCard({
      url: "https://github.com/microsoft/vscode",
      metadata: {
        linkPreview: { status: "success", title: "VS Code" },
      },
    });
    const result = await classifyLinkCategory(card);
    expect(result).toMatchObject({
      category: "repo",
      providerHint: "github",
    });
  });

  test("files a status an unlisted Mastodon instance confirmed as a social post", async () => {
    const result = await classifyLinkCategory(
      linkCard({
        url: "https://social.example.org/@alice/112233445566",
        metadata: {
          linkPreview: {
            status: "success",
            title: "Hello from my instance",
            categoryHint: "social_post",
          },
        },
      })
    );
    expect(result).toMatchObject({
      category: "social_post",
      reason: "preview_hint",
    });
  });

  test("leaves an unconfirmed Mastodon-like path on a blog as other", async () => {
    const result = await classifyLinkCategory(
      linkCard({
        url: "https://social.example.org/@alice/112233445566",
        metadata: {
          linkPreview: { status: "success", title: "Hello" },
        },
      })
    );
    expect(result?.category).toBe("other");
  });

  test("ignores a hint that is not a category, or on a failed preview", async () => {
    const url = "https://www.yelp.com/biz/tartine-bakery";
    const bogus = await classifyLinkCategory(
      linkCard({
        url,
        metadata: {
          linkPreview: { status: "success", categoryHint: "toString" },
        },
      })
    );
    const failed = await classifyLinkCategory(
      linkCard({
        url,
        metadata: {
          linkPreview: { status: "error", categoryHint: "social_post" },
        },
      })
    );
    expect(bogus?.category).toBe("place");
    expect(failed?.category).toBe("place");
  });

  test("returns null for missing targetUrl", async () => {
    expect(await classifyLinkCategory(linkCard({}))).toBeNull();
  });

  test("uses linkPreview finalUrl if available", async () => {
    const card = linkCard({
      metadata: {
        linkPreview: { status: "success", finalUrl: "https://amazon.com/p" },
      },
    });
    const result = await classifyLinkCategory(card);
    expect(result).toMatchObject({ providerHint: "amazon" });
  });
});

describe("enrichLinkCategory", () => {
  test("enriches with provider data (Amazon)", async () => {
    const card = linkCard({ url: "https://amazon.com/p" });
    const classification = {
      category: "product",
      providerHint: "amazon",
      confidence: 0.9,
    } as const;
    const result = await enrichLinkCategory(card, classification, {
      structuredData: null,
    });

    expect(result.detectedProvider).toBe("amazon");
  });

  test("covers stringArray and valueToText branches", async () => {
    const entity = {
      "@type": "Recipe",
      name: "R",
      recipeIngredient: "single ingredient",
    };
    const result = await enrichLinkCategory(
      linkCard({ url: "https://x.com" }),
      { category: "recipe", confidence: 0.9 },
      {
        structuredData: { entities: [entity] },
      }
    );
    expect(factValue(result, "Ingredients")).toBe("single ingredient");

    const entity2 = {
      "@type": "Recipe",
      name: "R",
      recipeIngredient: { name: "obj ingredient" },
    };
    const result2 = await enrichLinkCategory(
      linkCard({ url: "https://x.com" }),
      { category: "recipe", confidence: 0.9 },
      {
        structuredData: { entities: [entity2] },
      }
    );
    expect(factValue(result2, "Ingredients")).toBe("obj ingredient");
  });

  test("covers normalizeImage branches", async () => {
    const entity = { "@type": "Book", image: [{ url: "https://img1.com" }] };
    const result = await enrichLinkCategory(
      linkCard({ url: "https://x.com" }),
      { category: "book", confidence: 0.9 },
      {
        structuredData: { entities: [entity] },
      }
    );
    expect(result.imageUrl).toBe("https://img1.com");
  });

  test("covers buildRawSelectorMap branches", async () => {
    const card = linkCard({
      url: "https://github.com/a/b",
      metadata: {
        linkPreview: {
          status: "success",
          raw: [
            {
              selector: "a[href$='/stargazers']",
              results: [{ text: "1.2k" }],
            },
            { selector: "" },
          ],
        },
      },
    });
    const result = await enrichLinkCategory(
      card,
      {
        category: "software",
        providerHint: "github",
        confidence: 0.9,
      },
      { structuredData: null }
    );
    expect(factValue(result, "Stars")).toBe("1,200");
  });

  test("covers complex providerEnrichment image branch using Dribbble", async () => {
    const card = linkCard({
      url: "https://dribbble.com/shots/1",
      metadata: {
        linkPreview: {
          status: "success",
          raw: [
            {
              selector: "meta[property='og:image']",
              results: [
                {
                  attributes: [
                    { name: "content", value: "https://dribbble.img/1.jpg" },
                  ],
                },
              ],
            },
            {
              selector: ".shot-stats [data-label='Likes']",
              results: [{ text: "100" }],
            },
            {
              selector: "meta[name='twitter:label1']",
              results: [{ attributes: [{ name: "content", value: "Views" }] }],
            },
            {
              selector: "meta[name='twitter:data1']",
              results: [{ attributes: [{ name: "content", value: "200" }] }],
            },
            {
              selector: "meta[name='twitter:label2']",
              results: [
                { attributes: [{ name: "content", value: "Comments" }] },
              ],
            },
            {
              selector: "meta[name='twitter:data2']",
              results: [{ attributes: [{ name: "content", value: "300" }] }],
            },
            {
              selector: "meta[property='og:title']",
              results: [
                {
                  attributes: [
                    {
                      name: "content",
                      value: "Shot by Designer Name on Dribbble",
                    },
                  ],
                },
              ],
            },
            {
              selector: "meta[name='keywords']",
              results: [
                { attributes: [{ name: "content", value: "a,b,c,d,e,f" }] },
              ],
            },
          ],
        },
      },
    });
    const result = await enrichLinkCategory(
      card,
      {
        category: "design_portfolio",
        confidence: 0.9,
      },
      { structuredData: null }
    );
    expect(factValue(result, "Views")).toBe("200");
    expect(factValue(result, "Comments")).toBe("300");
    expect(factValue(result, "Designer")).toBe("Designer Name");
    expect(factValue(result, "Tags")).toBe("a, b, c");
  });

  test("covers Goodreads enrichment", async () => {
    const card = linkCard({
      url: "https://goodreads.com/b",
      metadata: {
        linkPreview: {
          status: "success",
          raw: [
            {
              selector: "meta[property='books:rating:average']",
              results: [{ attributes: [{ name: "content", value: "4.5" }] }],
            },
            {
              selector: "meta[property='books:rating:count']",
              results: [{ attributes: [{ name: "content", value: "1000" }] }],
            },
            {
              selector: "meta[property='books:isbn']",
              results: [{ attributes: [{ name: "content", value: "123" }] }],
            },
          ],
        },
      },
    });
    const result = await enrichLinkCategory(
      card,
      {
        category: "book",
        confidence: 0.9,
      },
      { structuredData: null }
    );
    expect(factValue(result, "Average rating")).toBe("4.50 / 5");
    expect(factValue(result, "Ratings")).toBe("1,000");
  });

  test("covers IMDb enrichment", async () => {
    const card = linkCard({
      url: "https://imdb.com/m",
      metadata: {
        linkPreview: {
          status: "success",
          raw: [
            {
              selector: "meta[name='imdb:rating']",
              results: [{ attributes: [{ name: "content", value: "8.5" }] }],
            },
            {
              selector: "meta[name='imdb:votes']",
              results: [{ attributes: [{ name: "content", value: "5000" }] }],
            },
            {
              selector: "span[data-testid='title-techspec_runtime'] span",
              results: [{ text: "2h 30m" }],
            },
            {
              selector: "meta[property='video:release_date']",
              results: [
                { attributes: [{ name: "content", value: "2020-01-01" }] },
              ],
            },
          ],
        },
      },
    });
    const result = await enrichLinkCategory(
      card,
      {
        category: "movie",
        confidence: 0.9,
      },
      { structuredData: null }
    );
    expect(factValue(result, "IMDb rating")).toBe("8.50 / 10");
    expect(factValue(result, "Votes")).toBe("5,000");
    expect(factValue(result, "Runtime")).toBe("2h 30m");
    expect(factValue(result, "Released")).toBe("Jan 1, 2020");
  });

  test("covers Amazon enrichment", async () => {
    const card = linkCard({
      url: "https://amazon.com/p",
      metadata: {
        linkPreview: {
          status: "success",
          raw: [
            {
              selector: ".a-price .a-offscreen",
              results: [{ text: "$19.99" }],
            },
            {
              selector: "meta[property='og:price:currency']",
              results: [{ attributes: [{ name: "content", value: "USD" }] }],
            },
          ],
        },
      },
    });
    const result = await enrichLinkCategory(
      card,
      {
        category: "product",
        confidence: 0.9,
      },
      { structuredData: null }
    );
    expect(factValue(result, "Price")).toBe("$19.99 USD");
  });

  describe("product price", () => {
    const amazonCard = (priceText?: string) =>
      linkCard({
        url: "https://www.amazon.com/dp/B0",
        metadata: {
          linkPreview: {
            status: "success",
            raw: priceText
              ? [
                  {
                    selector: ".a-price .a-offscreen",
                    results: [{ text: priceText }],
                  },
                ]
              : [],
          },
        },
      });
    const product = (offers: unknown) => ({
      "@type": "Product",
      name: "Lamp",
      offers,
    });
    const enrich = (
      card: CategorizationContextCard,
      entities: unknown[] | null
    ) =>
      enrichLinkCategory(
        card,
        { category: "product", confidence: 0.9 },
        { structuredData: entities ? { entities } : null }
      );

    test.each([
      [
        "a single offer",
        { "@type": "Offer", price: "24.99", priceCurrency: "USD" },
        { amount: 24.99, currency: "USD" },
      ],
      [
        "an offers array, at its lowest price",
        [
          { "@type": "Offer", price: 30, priceCurrency: "EUR" },
          { "@type": "Offer", price: "19.50", priceCurrency: "EUR" },
          { "@type": "Offer", price: "Contact us" },
        ],
        { amount: 19.5, currency: "EUR" },
      ],
      [
        "an AggregateOffer's lowPrice",
        {
          "@type": "AggregateOffer",
          lowPrice: "10",
          highPrice: "20",
          priceCurrency: "GBP",
        },
        { amount: 10, currency: "GBP" },
      ],
      [
        "a price specification",
        {
          "@type": "Offer",
          priceSpecification: { price: 0, priceCurrency: "USD" },
        },
        { amount: 0, currency: "USD" },
      ],
    ])("reads JSON-LD %s", async (_name, offers, expected) => {
      const result = await enrich(amazonCard(), [product(offers)]);
      expect(result.price).toEqual(expected);
    });

    test("prefers JSON-LD over the provider's selectors", async () => {
      const result = await enrich(amazonCard("$99.00"), [
        product({ "@type": "Offer", price: "89.00", priceCurrency: "CAD" }),
      ]);
      expect(result.price).toEqual({ amount: 89, currency: "CAD" });
      // Both prices stay as facts.
      expect(
        result.facts?.filter((fact) => fact.label === "Price").length
      ).toBe(2);
    });

    test("falls back to the provider's price without JSON-LD", async () => {
      const result = await enrich(amazonCard("$99.00"), null);
      expect(result.price).toEqual({ amount: 99, currency: "USD" });
    });

    test("falls back to the provider when the JSON-LD price is unusable", async () => {
      const result = await enrich(amazonCard("$99.00"), [
        product({ "@type": "Offer", price: "-5" }),
      ]);
      expect(result.price).toEqual({ amount: 99, currency: "USD" });
    });

    test("reads JSON-LD stored on an earlier pass", async () => {
      const card = linkCard({
        url: "https://shop.example/lamp",
        metadata: {
          linkCategory: {
            raw: {
              structured: product({
                "@type": "Offer",
                price: "12.00",
                priceCurrency: "EUR",
              }),
            },
          },
        },
      });
      const result = await enrichLinkCategory(
        card,
        { category: "product", confidence: 0.9 },
        { structuredData: null }
      );
      expect(result.price).toEqual({ amount: 12, currency: "EUR" });
    });

    test("drops a stored price when the page is read again without one", async () => {
      const card = linkCard({
        url: "https://shop.example/lamp",
        metadata: {
          linkCategory: {
            raw: {
              structured: product({
                "@type": "Offer",
                price: "12.00",
                priceCurrency: "EUR",
              }),
            },
          },
        },
      });
      const result = await enrich(card, []);
      expect(result.price).toBeUndefined();
      expect(result.raw?.structured).toBeUndefined();
    });

    test("prices a ProductGroup by its cheapest variant, and again from what it stored", async () => {
      // How Shopify stores describe a product with sizes.
      const group = {
        "@type": "ProductGroup",
        name: "T-shirt",
        hasVariant: ["XS", "S", "XL"].map((size, index) => ({
          "@type": "Product",
          name: `T-shirt - ${size}`,
          sku: `sku-${size}`,
          offers: {
            "@type": "Offer",
            price: index === 2 ? "44.99" : "39.99",
            priceCurrency: "EUR",
          },
        })),
      };
      const result = await enrich(
        linkCard({ url: "https://shop.example/t-shirt" }),
        [group]
      );
      expect(result.price).toEqual({ amount: 39.99, currency: "EUR" });
      expect(result.facts).toContainEqual({
        label: "Price",
        value: "€39.99",
      });
      // Only the variants' offers are kept.
      const stored = result.raw?.structured as { hasVariant: unknown[] };
      expect(stored.hasVariant[0]).toEqual({
        offers: group.hasVariant[0]?.offers,
      });

      const refreshed = await enrichLinkCategory(
        linkCard({
          url: "https://shop.example/t-shirt",
          metadata: {
            linkCategory: { ...result, raw: result.raw },
          },
        }),
        { category: "product", confidence: 0.9 },
        { structuredData: null }
      );
      expect(refreshed.price).toEqual({ amount: 39.99, currency: "EUR" });
    });

    test("has no price when no source states one", async () => {
      const result = await enrich(amazonCard(), [product(undefined)]);
      expect(result.price).toBeUndefined();
    });
  });

  test.each([
    [
      "an article's publish date",
      "article",
      {
        "@type": "Article",
        headline: "Lamps",
        datePublished: "2024-03-05",
      },
      "Published",
    ],
    [
      "a book's authors",
      "book",
      { "@type": "Book", name: "Lamps", author: [{ name: "Ada Lovelace" }] },
      "Authors",
    ],
    [
      "a place's address",
      "place",
      {
        "@type": "Restaurant",
        name: "Lamp Café",
        address: {
          streetAddress: "1 Main St",
          addressLocality: "Springfield",
        },
      },
      "Address",
    ],
  ] as const)(
    "keeps %s stored on an earlier pass when the page isn't read",
    async (_name, category, structured, label) => {
      const fresh = await enrichLinkCategory(
        linkCard({ url: "https://site.example/lamp" }),
        { category, confidence: 0.9 },
        { structuredData: { entities: [structured] } }
      );
      const expected = factValue(fresh, label);
      expect(expected).toBeTruthy();

      const result = await enrichLinkCategory(
        linkCard({
          url: "https://site.example/lamp",
          metadata: { linkCategory: { raw: fresh.raw } },
        }),
        { category, confidence: 0.9 },
        { structuredData: null }
      );
      expect(factValue(result, label)).toBe(expected);
      expect(result.raw?.structured).toEqual(fresh.raw?.structured);
    }
  );

  test("covers full GitHub enrichment", async () => {
    const card = linkCard({
      url: "https://github.com/a/b",
      metadata: {
        linkPreview: {
          status: "success",
          raw: [
            {
              selector: "a[href$='/stargazers']",
              results: [{ text: "100" }],
            },
            {
              selector: "a[href$='/network/members']",
              results: [{ text: "20" }],
            },
            { selector: "a[href$='/watchers']", results: [{ text: "5" }] },
            {
              selector: "span[itemprop='programmingLanguage']",
              results: [{ text: "TypeScript" }],
            },
            {
              selector: "relative-time",
              results: [{ text: "on Jan 1, 2023" }],
            },
          ],
        },
      },
    });
    const result = await enrichLinkCategory(
      card,
      {
        category: "software",
        confidence: 0.9,
      },
      { structuredData: null }
    );
    expect(factValue(result, "Stars")).toBe("100");
    expect(factValue(result, "Forks")).toBe("20");
    expect(factValue(result, "Watchers")).toBe("5");
    expect(factValue(result, "Language")).toBe("TypeScript");
    expect(factValue(result, "Updated")).toBe("Jan 1, 2023");
  });

  test("covers null returns from providers when no data", async () => {
    const providers = ["github", "amazon", "imdb", "goodreads", "dribbble"];
    for (const p of providers) {
      const result = await enrichLinkCategory(
        linkCard({ url: `https://${p}.com/test` }),
        { category: "article", confidence: 0.9 },
        { structuredData: null }
      );
      expect(result.facts).toBeUndefined();
    }
  });

  test("covers various edge cases in helpers", async () => {
    const res2 = await enrichLinkCategory(
      linkCard({ url: "https://[invalid]" }),
      { category: "article", confidence: 0.5 },
      { structuredData: null }
    );
    expect(res2).toBeDefined();

    const res3 = await enrichLinkCategory(
      linkCard({ url: "https://x.com" }),
      { category: "recipe", confidence: 0.9 },
      {
        structuredData: {
          entities: [{ "@type": "Recipe", recipeIngredient: { noName: "x" } }],
        },
      }
    );
    expect(res3.facts).toBeUndefined();

    const res4 = await enrichLinkCategory(
      linkCard({ url: "https://x.com" }),
      { category: "recipe", confidence: 0.9 },
      {
        structuredData: { entities: [{ "@type": "Recipe", recipeYield: 5 }] },
      }
    );
    expect(factValue(res4, "Servings")).toBe("5");
  });

  test("covers design_portfolio category in enrichWithStructuredData", async () => {
    const entity = {
      "@type": "CreativeWork",
      name: "D",
      author: { name: "C" },
    };
    const result = await enrichLinkCategory(
      linkCard({ url: "https://x.com" }),
      { category: "design_portfolio", confidence: 0.9 },
      {
        structuredData: { entities: [entity] },
      }
    );
    expect(factValue(result, "Creator")).toBe("C");
  });

  test("handles various categories in enrichWithStructuredData", async () => {
    const cases: {
      category: LinkCategory;
      entity: Record<string, unknown>;
      expectedFacts: string[];
    }[] = [
      {
        category: "book",
        entity: {
          "@type": "Book",
          name: "B",
          author: { name: "A" },
          aggregateRating: { ratingValue: 5, ratingCount: 10 },
          numberOfPages: 100,
          datePublished: "2020-01-01",
        },
        expectedFacts: ["Authors", "Rating", "Reviews", "Length", "Published"],
      },
      {
        category: "movie",
        entity: {
          "@type": "Movie",
          name: "M",
          aggregateRating: { ratingValue: 5, reviewCount: 10 },
          datePublished: "2020-01-01",
        },
        expectedFacts: ["Rating", "Votes", "Release"],
      },
      {
        category: "tv",
        entity: {
          "@type": "TVSeries",
          name: "T",
          numberOfSeasons: 5,
          numberOfEpisodes: 50,
          datePublished: "2020-01-01",
        },
        expectedFacts: ["Seasons", "Episodes", "First aired"],
      },
      {
        category: "article",
        entity: {
          "@type": "NewsArticle",
          name: "A",
          datePublished: "2020-01-01",
          dateModified: "2020-01-02",
        },
        expectedFacts: ["Published", "Updated"],
      },
      {
        category: "podcast",
        entity: {
          "@type": "PodcastEpisode",
          name: "P",
          duration: "PT1H",
          partOfSeries: { name: "S" },
        },
        expectedFacts: ["Duration", "Series"],
      },
      {
        category: "music",
        entity: {
          "@type": "MusicRecording",
          name: "M",
          byArtist: { name: "A" },
          duration: "PT3M",
        },
        expectedFacts: ["Artist", "Length"],
      },
      {
        category: "product",
        entity: {
          "@type": "Product",
          name: "P",
          offers: { price: 10, priceCurrency: "USD" },
          brand: { name: "B" },
        },
        expectedFacts: ["Price", "Brand"],
      },
      {
        category: "course",
        entity: { "@type": "Course", name: "C", provider: { name: "P" } },
        expectedFacts: ["Provider"],
      },
      {
        category: "research",
        entity: {
          "@type": "ScholarlyArticle",
          name: "S",
          author: [{ name: "A1" }, { name: "A2" }],
          datePublished: "2020-01-01",
        },
        expectedFacts: ["Authors", "Published"],
      },
      {
        category: "event",
        entity: {
          "@type": "Event",
          name: "E",
          startDate: "2020-01-01",
          endDate: "2020-01-02",
          location: { name: "L" },
        },
        expectedFacts: ["Dates", "Location"],
      },
      {
        category: "software",
        entity: {
          "@type": "SoftwareApplication",
          name: "S",
          operatingSystem: "iOS",
          applicationCategory: "Game",
        },
        expectedFacts: ["Platform", "Category"],
      },
      {
        category: "design_portfolio",
        entity: { "@type": "CreativeWork", name: "D", author: { name: "C" } },
        expectedFacts: ["Creator"],
      },
    ];

    for (const c of cases) {
      const result = await enrichLinkCategory(
        linkCard({ url: "https://x.com" }),
        { category: c.category, confidence: 0.9 },
        {
          structuredData: { entities: [c.entity] },
        }
      );
      for (const fact of c.expectedFacts) {
        expect((result.facts ?? []).some((f) => f.label === fact)).toBe(true);
      }
    }
  });

  test("handles array and object types in stringArray and valueToText", async () => {
    const entity = {
      "@type": "Recipe",
      name: "R",
      recipeYield: 4,
      prepTime: "PT10M",
      recipeIngredient: ["a", { name: "b" }, 123],
    };
    const result = await enrichLinkCategory(
      linkCard({ url: "https://x.com" }),
      { category: "recipe", confidence: 0.9 },
      {
        structuredData: { entities: [entity] },
      }
    );
    expect(factValue(result, "Servings")).toBe("4");
    expect(factValue(result, "Ingredients")).toContain("a, b");
  });

  test("handles various image formats in normalizeImage", async () => {
    const entity = {
      "@type": "Book",
      image: ["https://img1.com", { url: "https://img2.com" }],
    };
    const result = await enrichLinkCategory(
      linkCard({ url: "https://x.com" }),
      { category: "book", confidence: 0.9 },
      {
        structuredData: { entities: [entity] },
      }
    );
    expect(result.imageUrl).toBe("https://img1.com");

    const imageObj = { "@type": "Book", image: { url: "https://img3.com" } };
    const result2 = await enrichLinkCategory(
      linkCard({ url: "https://x.com" }),
      { category: "book", confidence: 0.9 },
      {
        structuredData: { entities: [imageObj] },
      }
    );
    expect(result2.imageUrl).toBe("https://img3.com");
  });

  test("handles provider detection edge cases", async () => {
    const urls = [
      "https://goodreads.com/b",
      "https://amazon.co.uk/p",
      "https://imdb.com/m",
      "https://netflix.com/t",
      "https://behance.net/p",
      "https://spotify.com/t",
      "https://apple.com/a",
      "https://youtube.com/v",
      "https://youtu.be/v",
      "https://medium.com/p",
      "https://substack.com/p",
    ];
    for (const url of urls) {
      const result = await enrichLinkCategory(
        linkCard({ url }),
        {
          category: "article",
          confidence: 0.9,
        },
        { structuredData: null }
      );
      expect(result.detectedProvider).toBeDefined();
    }
  });

  test.each([
    [
      "place",
      {
        "@type": "Restaurant",
        name: "Tartine",
        image: "https://example.com/tartine.jpg",
        address: {
          "@type": "PostalAddress",
          streetAddress: "600 Guerrero St",
          addressLocality: "San Francisco",
          addressRegion: "CA",
          postalCode: "94110",
          addressCountry: { name: "US" },
        },
        servesCuisine: ["Bakery", "Cafe"],
        priceRange: "$$",
        aggregateRating: { ratingValue: 4.5 },
      },
      {
        Address: "600 Guerrero St, San Francisco, CA, 94110, US",
        Cuisine: "Bakery, Cafe",
        "Price range": "$$",
        Rating: "4.5",
      },
    ],
    [
      "place",
      {
        "@type": "RealEstateListing",
        name: "1 Main St",
        about: {
          "@type": "SingleFamilyResidence",
          address: "1 Main St, Springfield",
        },
      },
      { Address: "1 Main St, Springfield" },
    ],
    [
      "app",
      {
        "@type": "MobileApplication",
        name: "Things 3",
        operatingSystem: "iOS",
        applicationCategory: "Productivity",
        aggregateRating: { ratingValue: 4.8 },
      },
      { Platform: "iOS", Category: "Productivity", Rating: "4.8" },
    ],
    [
      "game",
      {
        "@type": "VideoGame",
        name: "Hades",
        gamePlatform: ["PC", "Nintendo Switch"],
        genre: ["Roguelike", "Action"],
        aggregateRating: { ratingValue: 9.3 },
        datePublished: "2020-09-17T12:00:00Z",
      },
      {
        Platform: "PC, Nintendo Switch",
        Genre: "Roguelike, Action",
        Rating: "9.3",
        Released: "Sep 17, 2020",
      },
    ],
  ])("reads %s facts from JSON-LD", async (category, entity, expected) => {
    const result = await enrichLinkCategory(
      linkCard({ url: "https://example.com/page" }),
      { category: category as LinkCategory, confidence: 0.98 },
      { structuredData: { entities: [{ "@type": "WebSite" }, entity] } }
    );
    expect(
      Object.fromEntries(
        (result.facts ?? []).map((fact) => [fact.label, fact.value])
      )
    ).toEqual(expected);
  });

  test("uses the place's image when the preview has none", async () => {
    const result = await enrichLinkCategory(
      linkCard({ url: "https://example.com/page" }),
      { category: "place", confidence: 0.98 },
      {
        structuredData: {
          entities: [
            {
              "@type": "LocalBusiness",
              image: ["https://example.com/venue.jpg"],
              address: "1 Main St",
            },
          ],
        },
      }
    );
    expect(result.imageUrl).toBe("https://example.com/venue.jpg");
  });

  test("adds no JSON-LD facts for a game page without VideoGame data", async () => {
    const result = await enrichLinkCategory(
      linkCard({ url: "https://example.com/page" }),
      { category: "game", confidence: 0.98 },
      {
        structuredData: {
          entities: [{ "@type": "Product", name: "Hades" }],
        },
      }
    );
    expect(result.facts).toBeUndefined();
  });

  test("keeps GitHub's facts for a repository", async () => {
    const result = await enrichLinkCategory(
      linkCard({
        url: "https://github.com/vercel/next.js",
        metadata: {
          linkPreview: {
            status: "success",
            raw: [
              {
                selector: "a[href$='/stargazers']",
                results: [{ text: "1,234" }],
              },
            ],
          },
        },
      }),
      { category: "repo", confidence: 0.98, providerHint: "github" },
      { structuredData: null }
    );
    expect(result.facts?.find((f) => f.label === "Stars")?.value).toBe("1,234");
  });

  test("returns null from enrichWithStructuredData if no data found", async () => {
    const result = await enrichLinkCategory(
      linkCard({ url: "https://x.com" }),
      { category: "book", confidence: 0.9 },
      {
        structuredData: { entities: [{ "@type": "Other" }] },
      }
    );
    expect(result.facts).toBeUndefined();
  });
});

test("the snapshot it works from leaves unrelated customer fields out", () => {
  const card = {
    _id: "card1",
    aiTranscript: "transcript",
    content: "private ".repeat(10_000),
    metadata: {
      linkCategory: { category: "article", raw: { provider: "facts" } },
      linkPreview: {
        imageUrl: "https://example.com/image.png",
        media: [{ caption: "unneeded" }],
        raw: [{ selector: "title" }],
        rawSha256: "digest",
        rawStorageKey: "key",
        status: "success",
        title: "Title",
      },
    },
    notes: "notes",
    tags: ["user-tag"],
    type: "link",
    url: "https://example.com",
    userId: "user1",
  };
  const before = structuredClone(card);
  const snapshot = projectCategorizationSnapshot(card);
  expect(snapshot.metadata.linkCategory).toEqual(card.metadata.linkCategory);
  expect(snapshot.metadata.linkPreview).toMatchObject({
    raw: card.metadata.linkPreview.raw,
    rawSha256: "digest",
    rawStorageKey: "key",
    status: "success",
    title: "Title",
  });
  for (const field of ["content", "notes", "tags", "aiTranscript"]) {
    expect(snapshot).not.toHaveProperty(field);
  }
  expect(snapshot.metadata.linkPreview).not.toHaveProperty("media");
  expect(JSON.stringify(snapshot).length).toBeLessThan(1024);
  expect(card).toEqual(before);
});
