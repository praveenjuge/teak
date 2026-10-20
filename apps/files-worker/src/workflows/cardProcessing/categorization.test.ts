import { describe, expect, test } from "bun:test";
import { SCRAPE_ELEMENTS } from "@teak/convex/linkMetadata/selectors";
import type { LinkCategoryMetadata } from "@teak/convex/shared";
import { parseStructuredData } from "@teak/convex/workflows/steps/categorization/rules";
import type { FilesOp } from "@teak/files-protocol";
import { sha256Hex } from "../../lib";
import {
  CARD_ID,
  createCardConvex,
  createFakeOps,
  createMemoryBucket,
  type FakeCard,
  makeCard,
  type OpAnswer,
  testDeps,
  testEnv,
  testJob,
  USER_ID,
} from "../../test/cardProcessingKit";
import { categorizeLink } from "./categorization";
import { rawMetadataKey } from "./rawMetadata";

const gzipBase64 = async (text: string) => {
  const bytes = new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))
    ).arrayBuffer()
  );
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const pageWith = async (html: string): Promise<OpAnswer> => ({
  data: {
    charset: "utf-8",
    fetched: true,
    htmlGzipBase64: await gzipBase64(html),
    pageUrl: "https://example.com",
    selectors: [],
    source: "static",
  },
});

const jsonLd = (value: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

const categorize = (
  fields: Partial<FakeCard> | null,
  answers: Partial<Record<FilesOp, OpAnswer>> = {},
  bucket: R2Bucket = createMemoryBucket().bucket,
  options: {
    aiGate?: string;
    arxivSlot?: { retryAfter: number } | null;
    network?: (url: string) => Response | undefined;
    refresh?: boolean;
  } = {}
) => {
  const card = fields
    ? makeCard({
        processingStatus: { categorize: { status: "pending" } },
        type: "link",
        ...fields,
      })
    : null;
  const convex = createCardConvex(card, {
    "adminAccess:getAiGate": () => options.aiGate ?? "allowed",
    "workflows/steps/categorization/mutations:takeArxivSlot": () =>
      options.arxivSlot === undefined ? { retryAfter: 0 } : options.arxivSlot,
  });
  const fakes = createFakeOps(answers);
  const env = testEnv({ BUCKET: bucket });
  const siteRequests: string[] = [];
  const network = options.network
    ? {
        pinnedFetch: (url: string) => {
          siteRequests.push(url);
          return Promise.resolve(
            options.network?.(url) ?? new Response("{}", { status: 404 })
          );
        },
      }
    : {};
  const run = () =>
    categorizeLink({
      ...testJob(env, testDeps(env, convex.fetcher, fakes.ops, network)),
      ...(options.refresh ? { refresh: true } : {}),
    });
  const saved = () =>
    convex
      .callsTo("workflows/steps/categorization/mutations:updateCategorization")
      .at(-1)?.args.metadata as LinkCategoryMetadata | undefined;
  return { card, convex, fakes, run, saved, siteRequests };
};

const json = (body: unknown) => Response.json(body);

const WIKIPEDIA_ARTICLE = "https://en.wikipedia.org/wiki/Photosynthesis";
const WIKIPEDIA_SUMMARY =
  "https://en.wikipedia.org/api/rest_v1/page/summary/Photosynthesis";
const LEAD_IMAGE = "https://upload.wikimedia.org/leaf.png";

describe("categorization", () => {
  describe("categorizeLink", () => {
    test("a card deleted before categorization is missing", async () => {
      const { run } = categorize(null);
      expect((await run()).mode).toBe("missing");
    });

    test("refuses a card that is not a link", async () => {
      const { run } = categorize({ type: "text" });
      await expect(run()).rejects.toThrow("is not a link card");
    });

    test("keeps fresh metadata for the same URL without reading the page", async () => {
      const existing = {
        category: "article",
        confidence: 0.8,
        fetchedAt: Date.now() - 1000,
        sourceUrl: "https://example.com/a",
      };
      const { card, convex, fakes, run, saved } = categorize({
        metadata: { linkCategory: existing },
        url: "https://example.com/a?utm_source=feed",
      });
      expect(await run()).toEqual({
        category: "article",
        confidence: 0.8,
        mode: "categorized",
      });
      expect(saved()).toEqual(existing);
      expect(fakes.calls).toEqual([]);
      expect(
        convex.stageWrites.filter((write) => write.stage === "categorize")
      ).toEqual([
        { stage: "categorize", status: "in_progress" },
        { stage: "categorize", status: "completed" },
      ]);
      expect(card?.processingStatus?.categorize?.status).toBe("completed");
    });

    test("classifies again when the URL changed", async () => {
      const { run, saved } = categorize(
        {
          metadata: {
            linkCategory: {
              category: "article",
              fetchedAt: Date.now() - 1000,
              sourceUrl: "https://example.com/a",
            },
          },
          url: "https://github.com/microsoft/vscode",
        },
        { "fetch-link-page": { fallback: "NOT_FOUND" } }
      );
      expect((await run()).category).toBe("repo");
      expect(saved()?.sourceUrl).toBe("https://github.com/microsoft/vscode");
    });

    test("fails a link with no URL to classify", async () => {
      const { run } = categorize({ url: "" });
      await expect(run()).rejects.toThrow("Failed to classify");
    });

    test("follows the stored preview's category hint", async () => {
      const { run } = categorize(
        {
          metadata: {
            linkPreview: {
              categoryHint: "social_post",
              status: "success",
              title: "Hello",
            },
          },
          url: "https://social.example.org/@alice/112233445566",
        },
        { "fetch-link-page": { fallback: "NOT_FOUND" } }
      );
      expect((await run()).category).toBe("social_post");
    });

    test("a refresh classifies fresh metadata again and reads its JSON-LD again", async () => {
      const fetchedAt = Date.now() - 1000;
      const { fakes, run, saved } = categorize(
        {
          metadata: {
            linkCategory: {
              category: "product",
              fetchedAt,
              raw: {
                structured: { "@type": "Product" },
                structuredMeta: { fetchedAt },
              },
              sourceUrl: "https://github.com/microsoft/vscode",
            },
          },
          url: "https://github.com/microsoft/vscode",
        },
        {
          "fetch-link-page": await pageWith(
            jsonLd({ "@type": "SoftwareSourceCode", name: "vscode" })
          ),
        },
        undefined,
        { refresh: true }
      );
      expect((await run()).category).toBe("repo");
      expect(fakes.opsCalled()).toEqual(["fetch-link-page"]);
      const structuredMeta = saved()?.raw?.structuredMeta as
        | { fetchedAt?: number }
        | undefined;
      expect(structuredMeta?.fetchedAt).toBeGreaterThan(fetchedAt);
    });

    describe("site details", () => {
      const wikipedia = () =>
        json({
          description: "Biological process",
          extract: "Photosynthesis turns light into chemical energy.",
          originalimage: { source: LEAD_IMAGE },
          timestamp: "2026-10-01T00:00:00Z",
          type: "standard",
        });

      test("adds Wikipedia's facts and stores its lead image for a page with none", async () => {
        const { convex, fakes, run, saved, siteRequests } = categorize(
          {
            metadata: { linkPreview: { status: "success", title: "Leaf" } },
            url: WIKIPEDIA_ARTICLE,
          },
          {
            "fetch-link-page": { fallback: "NOT_FOUND" },
            "store-remote-asset": {
              data: {
                contentType: "image/png",
                height: 600,
                size: 10,
                stored: true,
                width: 800,
              },
            },
          },
          undefined,
          {
            network: (url) =>
              url === WIKIPEDIA_SUMMARY ? wikipedia() : undefined,
          }
        );

        expect((await run()).category).toBe("article");
        expect(siteRequests).toEqual([WIKIPEDIA_SUMMARY]);
        expect(saved()?.facts).toEqual([
          { label: "About", value: "Biological process" },
          { label: "Updated", value: "Oct 1, 2026" },
        ]);
        const store = fakes.calls.find(
          (call) => call.op === "store-remote-asset"
        );
        expect(store?.params).toMatchObject({ kind: "image", url: LEAD_IMAGE });
        const write = convex
          .callsTo(
            "workflows/steps/categorization/mutations:updateCategorization"
          )
          .at(-1)?.args;
        expect(write?.previewImage).toMatchObject({
          imageHeight: 600,
          imageWidth: 800,
        });
      });

      test("never replaces the page's own image", async () => {
        const { convex, fakes, run } = categorize(
          {
            metadata: {
              linkPreview: {
                imageUrl: "https://upload.wikimedia.org/og.png",
                status: "success",
              },
            },
            url: WIKIPEDIA_ARTICLE,
          },
          { "fetch-link-page": { fallback: "NOT_FOUND" } },
          undefined,
          { network: () => wikipedia() }
        );

        await run();

        expect(fakes.opsCalled()).not.toContain("store-remote-asset");
        expect(
          convex
            .callsTo(
              "workflows/steps/categorization/mutations:updateCategorization"
            )
            .at(-1)?.args.previewImage
        ).toBeUndefined();
      });

      test("a site that is down still saves the category", async () => {
        const { run, saved } = categorize(
          {
            metadata: { linkPreview: { status: "success" } },
            url: WIKIPEDIA_ARTICLE,
          },
          { "fetch-link-page": { fallback: "NOT_FOUND" } },
          undefined,
          { network: () => new Response("down", { status: 503 }) }
        );

        expect(await run()).toMatchObject({
          category: "article",
          mode: "categorized",
        });
        expect(saved()?.facts).toBeUndefined();
      });

      test("arXiv is asked only with a free API slot", async () => {
        const { run, saved, siteRequests } = categorize(
          {
            metadata: { linkPreview: { status: "success" } },
            url: "https://arxiv.org/abs/1706.03762",
          },
          { "fetch-link-page": { fallback: "NOT_FOUND" } },
          undefined,
          { arxivSlot: null, network: () => undefined }
        );

        expect((await run()).category).toBe("research");
        expect(siteRequests).toEqual([]);
        expect(saved()?.pdfUrl).toBeUndefined();
      });

      test("other links ask no site", async () => {
        const { run, siteRequests } = categorize(
          {
            metadata: { linkPreview: { status: "success" } },
            url: "https://example.com/blog/post",
          },
          { "fetch-link-page": { fallback: "NOT_FOUND" } },
          undefined,
          { network: () => undefined }
        );

        await run();

        expect(siteRequests).toEqual([]);
      });
    });

    describe("Clef review", () => {
      const soupPreview = {
        linkPreview: {
          description: "Ingredients and steps.",
          siteName: "Example Kitchen",
          status: "success",
          title: "Weeknight lentil soup",
        },
      };
      const decided = (
        category: string | null,
        confidence = 0.96
      ): OpAnswer => ({
        data: {
          decision: category ? { category, confidence } : null,
          model: "@cf/cloudflare/clef",
          usage: { inputTokens: 100, outputTokens: 0 },
          version: 1,
        },
      });
      const soup = (decision: OpAnswer, options: { aiGate?: string } = {}) =>
        categorize(
          { metadata: soupPreview, url: "https://example.com/soup" },
          {
            "decide-link-category": decision,
            "fetch-link-page": { fallback: "NOT_FOUND" },
          },
          undefined,
          options
        );

      test("takes Clef's category for a fallback guess", async () => {
        const { fakes, run, saved } = soup(decided("recipe"));
        expect(await run()).toEqual({
          category: "recipe",
          confidence: 0.96,
          mode: "categorized",
        });
        expect(saved()?.category).toBe("recipe");
        expect(
          fakes.calls.find((call) => call.op === "decide-link-category")?.params
        ).toEqual({
          description: "Ingredients and steps.",
          jsonLdTypes: [],
          rulesCategory: "other",
          siteName: "Example Kitchen",
          title: "Weeknight lentil soup",
          url: "https://example.com/soup",
        });
      });

      test("sends the page's JSON-LD types", async () => {
        const { fakes, run } = categorize(
          { metadata: soupPreview, url: "https://example.com/soup" },
          {
            "decide-link-category": decided("recipe"),
            "fetch-link-page": await pageWith(
              jsonLd({ "@graph": [{ "@type": ["Recipe", "HowTo"] }] })
            ),
          }
        );
        await run();
        expect(
          fakes.calls.find((call) => call.op === "decide-link-category")?.params
            .jsonLdTypes
        ).toEqual(["Recipe", "HowTo"]);
      });

      test("never asks Clef about a domain rule", async () => {
        const { fakes, run } = categorize(
          { url: "https://github.com/microsoft/vscode" },
          {
            "decide-link-category": decided("article"),
            "fetch-link-page": { fallback: "NOT_FOUND" },
          }
        );
        expect((await run()).category).toBe("repo");
        expect(fakes.opsCalled()).not.toContain("decide-link-category");
      });

      test.each([
        ["no decision", decided(null)],
        ["an unknown category", decided("cookbook")],
        ["a failing op", { throws: new Error("files_worker_error:x") }],
      ] as const)("keeps the rules with %s", async (_name, answer) => {
        const { run } = soup(answer);
        expect((await run()).category).toBe("other");
      });

      test.each(["user_disabled", "paused"])(
        "skips Clef when AI is %s",
        async (aiGate) => {
          const { fakes, run } = soup(decided("recipe"), { aiGate });
          expect((await run()).category).toBe("other");
          expect(fakes.opsCalled()).not.toContain("decide-link-category");
        }
      );
    });

    test("reads JSON-LD from the page the preview fetched", async () => {
      const { fakes, run, saved } = categorize(
        { url: "https://www.goodreads.com/book/show/5907.The_Hobbit" },
        {
          "fetch-link-page": await pageWith(
            jsonLd({
              "@type": "Book",
              aggregateRating: { ratingValue: 4.3 },
              author: { name: "J.R.R. Tolkien" },
              name: "The Hobbit",
            })
          ),
        }
      );
      await run();
      expect(fakes.calls).toEqual([
        {
          op: "fetch-link-page",
          params: {
            selectors: SCRAPE_ELEMENTS.map(({ selector }) => selector),
            url: "https://www.goodreads.com/book/show/5907.The_Hobbit",
          },
        },
      ]);
      expect(saved()?.raw?.structured).toMatchObject({ name: "The Hobbit" });
      expect(
        (saved()?.raw?.structuredMeta as { fetchedAt: number } | undefined)
          ?.fetchedAt
      ).toBeNumber();
    });

    test.each([
      ["the op declines", { fallback: "NOT_FOUND" as const }],
      ["the page failed", { data: { fetched: false, reason: "http_error" } }],
      ["the op throws", { throws: new Error("files_worker_error:X:500:r") }],
    ])("categorizes without JSON-LD when %s", async (_name, answer) => {
      const { run, saved } = categorize(
        { url: "https://example.com/post" },
        { "fetch-link-page": answer as OpAnswer }
      );
      expect((await run()).mode).toBe("categorized");
      expect(saved()?.raw?.structured).toBeUndefined();
    });

    test("parses at most 8 distinct JSON-LD entities, skipping invalid blocks", () => {
      const entities = Array.from({ length: 10 }, (_, index) => ({
        "@type": "Thing",
        name: `item${index}`,
      }));
      const parsed = parseStructuredData(
        `<script type="application/ld+json">{ invalid json }</script>${jsonLd(entities)}${jsonLd(entities[0])}`
      );
      expect(parsed.entities.map((entity) => entity.name)).toEqual(
        entities.slice(0, 8).map((entity) => entity.name)
      );
    });

    test("stores the first recipe of several JSON-LD entities", async () => {
      const entities = Array.from({ length: 10 }, (_, index) => ({
        "@type": "Recipe",
        name: `item${index}`,
        recipeYield: index,
      }));
      const { run, saved } = categorize(
        { url: "https://www.allrecipes.com/recipe/1/x" },
        {
          "fetch-link-page": await pageWith(
            `<script type="application/ld+json">{ invalid json }</script>${jsonLd(entities)}`
          ),
        }
      );
      await run();
      expect(saved()?.raw?.structured).toMatchObject({ name: "item0" });
    });

    test("reads JSON-LD only from the first 250,000 characters", async () => {
      const { run, saved } = categorize(
        { url: "https://www.allrecipes.com/recipe/1/x" },
        {
          "fetch-link-page": await pageWith(
            `${"A".repeat(300_000)}${jsonLd({ "@type": "Recipe", name: "Late" })}`
          ),
        }
      );
      await run();
      expect(saved()?.raw?.structured).toBeUndefined();
    });

    test.each([
      { fresh: false, hasStructured: true, reads: false },
      { fresh: true, hasStructured: false, reads: false },
      { fresh: false, hasStructured: false, reads: true },
    ])(
      "honors archived JSON-LD facts: structured=$hasStructured fresh=$fresh",
      async ({ fresh, hasStructured, reads }) => {
        const { fakes, run } = categorize(
          {
            metadata: {
              linkCategory: {
                category: "article",
                fetchedAt: 1,
                rawHasStructured: hasStructured,
                rawStructuredFetchedAt: fresh ? Date.now() : 1,
                sourceUrl: "https://example.com/post",
              },
            },
            url: "https://example.com/post",
          },
          { "fetch-link-page": { fallback: "NOT_FOUND" } }
        );
        expect((await run()).mode).toBe("categorized");
        expect(fakes.opsCalled().includes("fetch-link-page")).toBe(reads);
      }
    );

    test("enriches from archived preview data and keeps archived provider facts", async () => {
      const memory = createMemoryBucket();
      const archive = async (
        kind: "linkCategory" | "linkPreview",
        raw: unknown
      ) => {
        const json = JSON.stringify(raw);
        const digest = await sha256Hex(json);
        const key = rawMetadataKey(
          "",
          { _id: CARD_ID, userId: USER_ID },
          kind,
          digest
        );
        memory.objects.set(key, json);
        return { rawSha256: digest, rawStorageKey: key };
      };
      const sourceUrl = "https://www.goodreads.com/book/show/123";
      const rawCategory = {
        provider: { diagnostic: "Keep provider evidence" },
        structured: { headline: "Customer metadata" },
        structuredMeta: { fetchedAt: 120 },
      };
      const { run, saved } = categorize(
        {
          metadata: {
            linkCategory: {
              category: "book",
              fetchedAt: 1,
              sourceUrl,
              ...(await archive("linkCategory", rawCategory)),
            },
            linkPreview: {
              status: "success",
              ...(await archive("linkPreview", [
                {
                  results: [
                    { attributes: [{ name: "content", value: "4.5" }] },
                  ],
                  selector: "meta[property='books:rating:average']",
                },
                {
                  results: [
                    {
                      attributes: [{ name: "content", value: "9781234567890" }],
                    },
                  ],
                  selector: "meta[property='books:isbn']",
                },
              ])),
            },
          },
          url: sourceUrl,
        },
        {},
        memory.bucket
      );

      await run();

      expect(saved()?.facts).toEqual(
        expect.arrayContaining([
          { label: "Average rating", value: "4.50 / 5" },
          { label: "ISBN", value: "9781234567890" },
        ])
      );
      expect(saved()?.raw).toMatchObject({
        provider: {
          diagnostic: "Keep provider evidence",
          isbn: "9781234567890",
          ratingAverage: "4.50",
        },
        structured: rawCategory.structured,
      });
    });

    test("archives a large raw category in R2 and sends Convex only its reference", async () => {
      const memory = createMemoryBucket();
      const raw = {
        structured: { "@type": "Article", headline: "Keep ".repeat(300) },
        structuredMeta: { fetchedAt: 120 },
      };
      const { convex, run, saved } = categorize(
        {
          metadata: {
            linkCategory: {
              category: "article",
              confidence: 0.8,
              fetchedAt: Date.now() - 1000,
              raw,
              sourceUrl: "https://example.com/a",
            },
          },
          url: "https://example.com/a",
        },
        {},
        memory.bucket
      );

      await run();

      expect(memory.objects.size).toBe(1);
      const [[key, json]] = [...memory.objects];
      expect(JSON.parse(json)).toEqual(raw);
      const digest = await sha256Hex(json);
      expect(key).toBe(
        rawMetadataKey(
          "",
          { _id: CARD_ID, userId: USER_ID },
          "linkCategory",
          digest
        )
      );
      expect(saved()).toMatchObject({
        category: "article",
        rawHasStructured: true,
        rawSha256: digest,
        rawStorageKey: key,
        rawStructuredFetchedAt: 120,
      });
      expect(saved()).not.toHaveProperty("raw");
      expect(
        convex.callsTo("storage/ownership:registerObject")[0]
      ).toMatchObject({
        args: { key, userId: USER_ID },
        guard: { cardId: CARD_ID, rev: 1 },
      });
    });

    test("does not read the page again when its JSON-LD is stored and fresh", async () => {
      const { fakes, run } = categorize({
        metadata: {
          linkCategory: {
            category: "recipe",
            raw: {
              structured: { "@type": "Recipe", name: "Stored" },
              structuredMeta: { fetchedAt: Date.now() - 1000 },
            },
          },
        },
        url: "https://www.allrecipes.com/recipe/2/y",
      });
      await run();
      expect(fakes.calls).toEqual([]);
    });
  });
});
