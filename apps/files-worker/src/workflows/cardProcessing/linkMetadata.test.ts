import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SCRAPE_ELEMENTS } from "@teak/convex/linkMetadata/selectors";
import { buildSelectorResultsFromHtml } from "@teak/convex/linkMetadata/staticHtml";
import type { FilesOp } from "@teak/files-protocol";
import { createContainerPinnedFetch } from "../../pinnedHop";
import {
  CARD_ID,
  createCardConvex,
  createContainerNetwork,
  createFakeOps,
  type FakeCard,
  makeCard,
  type OpAnswer,
  testDeps,
  testEnv,
  testJob,
  USER_ID,
} from "../../test/cardProcessingKit";
import { fetchLinkMetadata } from "./linkMetadata";

const PUBLIC = "93.184.216.34";
const URL_ = "https://example.com/article";

const socialFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../../../packages/convex/__tests__/linkMetadata/fixtures/social/${name}`,
        import.meta.url
      ),
      "utf8"
    )
  );

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

const page = async (html: string, pageUrl = URL_): Promise<OpAnswer> => ({
  data: {
    charset: "utf-8",
    fetched: true,
    htmlGzipBase64: await gzipBase64(html),
    pageUrl,
    selectors: buildSelectorResultsFromHtml(html, SCRAPE_ELEMENTS),
    source: "static",
  },
});

const ARTICLE = `<html><head>
  <title>Fallback</title>
  <meta property="og:title" content="A good article">
  <meta property="og:description" content="About good things">
  <meta property="og:image" content="https://cdn.example/cover.jpg">
</head></html>`;

const linkCard = (url = URL_, fields: Partial<FakeCard> = {}) =>
  makeCard({
    content: url,
    metadataStatus: "pending",
    processingStatus: { classify: { status: "completed" } },
    type: "link",
    url,
    ...fields,
  });

const setup = (
  card: FakeCard | null,
  answers: Partial<
    Record<FilesOp, OpAnswer | ((params: Record<string, unknown>) => OpAnswer)>
  > = {},
  options: {
    addresses?: string[];
    handlers?: Parameters<typeof createCardConvex>[1];
    route?: (url: string) => Response | undefined;
  } = {}
) => {
  const convex = createCardConvex(card, options.handlers);
  const fakes = createFakeOps(answers);
  const network = createContainerNetwork(options.route ?? (() => undefined));
  const env = testEnv(network.env);
  const job = testJob(
    env,
    testDeps(env, convex.fetcher, fakes.ops, {
      pinnedFetch: createContainerPinnedFetch(env),
      resolveDns: () => Promise.resolve(options.addresses ?? [PUBLIC]),
    })
  );
  const saved = () =>
    convex.callsTo("linkMetadata:updateCardMetadata").at(-1)?.args as
      | {
          linkPreview: Record<string, any>;
          status: string;
        }
      | undefined;
  return {
    convex,
    fakes,
    fetch: () => fetchLinkMetadata(job),
    network,
    saved,
  };
};

describe("link metadata", () => {
  test("stores the preview the page states", async () => {
    const { fakes, fetch, saved } = setup(linkCard(), {
      "fetch-link-page": await page(ARTICLE),
      "store-remote-asset": {
        data: {
          contentType: "image/jpeg",
          height: 630,
          size: 10,
          stored: true,
          width: 1200,
        },
      },
    });

    expect(await fetch()).toEqual({ status: "success" });
    expect(fakes.calls[0]).toEqual({
      op: "fetch-link-page",
      params: {
        selectors: SCRAPE_ELEMENTS.map(({ selector }) => selector),
        url: URL_,
      },
    });
    expect(saved()?.status).toBe("completed");
    expect(saved()?.linkPreview).toMatchObject({
      description: "About good things",
      imageHeight: 630,
      imageUrl: "https://cdn.example/cover.jpg",
      imageWidth: 1200,
      status: "success",
      title: "A good article",
    });
  });

  test("registers the preview image's owner before storing it", async () => {
    const { convex, fakes, fetch, saved } = setup(linkCard(), {
      "fetch-link-page": await page(ARTICLE),
      "store-remote-asset": {
        data: { contentType: "image/jpeg", height: 1, stored: true, width: 1 },
      },
    });
    await fetch();
    const store = fakes.calls.find((call) => call.op === "store-remote-asset");
    const key = store?.params.destinationKey as string;
    expect(key).toContain(`/cards/${CARD_ID}/link-preview-image/`);
    expect(store?.params).toMatchObject({
      kind: "image",
      pageUrl: URL_,
      url: "https://cdn.example/cover.jpg",
    });
    expect(convex.callsTo("storage/ownership:registerObject")[0]?.args).toEqual(
      { key, userId: USER_ID }
    );
    expect(saved()?.linkPreview.imageStorageKey).toBe(key);
  });

  test("keeps the preview without its image when the fetcher skips it", async () => {
    const { fetch, saved } = setup(linkCard(), {
      "fetch-link-page": await page(ARTICLE),
      "store-remote-asset": { data: { reason: "too_large", stored: false } },
    });
    expect(await fetch()).toEqual({ status: "success" });
    expect(saved()?.linkPreview.title).toBe("A good article");
    expect(saved()?.linkPreview).not.toHaveProperty("imageStorageKey");
  });

  describe("cards it cannot fetch for", () => {
    test("a deleted card stores an invalid-card preview", async () => {
      const convex = createCardConvex(null, {
        "linkMetadata:updateCardMetadata": () => null,
      });
      const env = testEnv();
      const result = await fetchLinkMetadata(
        testJob(env, testDeps(env, convex.fetcher, createFakeOps({}).ops))
      );
      expect(result).toEqual({ errorType: "invalid_card", status: "failed" });
    });

    test("a card that is not a link stores an invalid-card preview", async () => {
      const { fetch, saved } = setup(linkCard(URL_, { type: "text" }));
      expect(await fetch()).toEqual({
        errorType: "invalid_card",
        status: "failed",
      });
      expect(saved()?.linkPreview.error).toMatchObject({
        message: "Card is not a link",
        type: "invalid_card",
      });
    });

    test.each(["pending", "in_progress"])(
      "waits while classification is %s",
      async (status) => {
        const { fetch } = setup(
          linkCard(URL_, { processingStatus: { classify: { status } } })
        );
        await expect(fetch()).rejects.toThrow(/awaiting_classification/);
      }
    );

    test("stores a paused preview while link fetching is paused", async () => {
      const { fakes, fetch, saved } = setup(
        linkCard(),
        {},
        { handlers: { "adminAccess:isLinkFetchPaused": () => true } }
      );
      expect(await fetch()).toEqual({
        errorType: "fetching_paused",
        status: "failed",
      });
      expect(fakes.calls).toEqual([]);
      expect(saved()?.status).toBe("failed");
    });

    test("refuses a host that resolves to a private address", async () => {
      const { fakes, fetch, saved } = setup(
        linkCard(),
        {},
        { addresses: ["10.0.0.4"] }
      );
      expect(await fetch()).toEqual({
        errorType: "blocked_url",
        status: "failed",
      });
      expect(fakes.calls).toEqual([]);
      expect(saved()?.linkPreview.error.type).toBe("blocked_url");
    });

    test("refuses a page whose redirect reached a disallowed destination", async () => {
      const { fetch } = setup(linkCard(), {
        "fetch-link-page": { data: { fetched: false, reason: "blocked_url" } },
      });
      expect(await fetch()).toEqual({
        errorType: "blocked_url",
        status: "failed",
      });
    });
  });

  describe("pages that fail", () => {
    test.each([400, 401, 403, 404, 410])(
      "stores a failed preview for HTTP %d, without retrying",
      async (status) => {
        const { fetch, saved } = setup(linkCard(), {
          "fetch-link-page": {
            data: { fetched: false, reason: "http_error", status },
          },
        });
        expect(await fetch()).toEqual({
          errorType: "http_error",
          status: "failed",
        });
        expect(saved()?.linkPreview.error).toMatchObject({
          details: { status },
          message: `HTTP ${status}`,
        });
      }
    );

    test("stores a failed preview for a PDF, without retrying", async () => {
      const { fetch, saved } = setup(linkCard(), {
        "fetch-link-page": {
          data: {
            contentType: "application/pdf",
            fetched: false,
            reason: "unsupported_type",
          },
        },
      });
      expect(await fetch()).toEqual({
        errorType: "unsupported_type",
        status: "failed",
      });
      expect(saved()?.status).toBe("failed");
      expect(saved()?.linkPreview.error).toMatchObject({
        details: { contentType: "application/pdf" },
        type: "unsupported_type",
      });
    });

    test.each([
      ["a 429", { reason: "http_error", status: 429 }, /"type":"rate_limit"/],
      [
        "a 503",
        { reason: "http_error", status: 503 },
        /^(?=.*"type":"scrape_error")(?=.*HTTP 503)/,
      ],
      ["a page over 2 MiB", { reason: "too_large" }, /too_large/],
      ["a failed connection", { reason: "fetch_failed" }, /fetch_failed/],
    ])("retries %s", async (_name, data, message) => {
      const { convex, fetch } = setup(linkCard(), {
        "fetch-link-page": { data: { fetched: false, ...data } },
      });
      await expect(fetch()).rejects.toThrow(message);
      expect(convex.callsTo("linkMetadata:updateCardMetadata")).toEqual([]);
    });

    test.each([
      [
        "busy",
        {
          throws: new Error("files_worker_error:RENDERER_UNAVAILABLE:503:r"),
        },
      ],
      ["declining", { fallback: "UNSUPPORTED" as const }],
    ])("retries when the op is %s", async (_name, answer) => {
      const { fetch } = setup(linkCard(), { "fetch-link-page": answer });
      await expect(fetch()).rejects.toThrow(
        /^(?=.*"type":"scrape_error")(?=.*Link page fetch unavailable)/
      );
    });
  });

  describe("Instagram", () => {
    const POST = "https://www.instagram.com/p/DBY4WfSxA0a/";
    const CDN = "https://scontent.cdninstagram.com/v/t51";
    const relayPage = (item: Record<string, unknown>) => `
      <html><head>
        <meta property="og:title" content="Instagram post">
        <script type="application/json" data-sjs>${JSON.stringify({
          require: [
            [
              "ScheduledServerJS",
              "handle",
              null,
              [
                {
                  __bbox: {
                    result: {
                      data: {
                        xdt_api__v1__media__shortcode__web_info: {
                          items: [item],
                        },
                      },
                    },
                  },
                },
              ],
            ],
          ],
        })}</script>
      </head></html>`;

    test("stores the post's media from the page it already fetched, with the final URL as Referer", async () => {
      const finalUrl = `${POST}?hl=en`;
      const { fakes, fetch, saved } = setup(linkCard(POST), {
        "fetch-link-page": await page(
          relayPage({
            code: "DBY4WfSxA0a",
            image_versions2: {
              candidates: [
                { height: 1350, url: `${CDN}/one.jpg`, width: 1080 },
              ],
            },
          }),
          finalUrl
        ),
        "store-remote-asset": {
          data: {
            contentType: "image/jpeg",
            height: 1350,
            stored: true,
            width: 1080,
          },
        },
      });

      expect(await fetch()).toEqual({ status: "success" });
      const stores = fakes.calls.filter(
        (call) => call.op === "store-remote-asset"
      );
      expect(
        stores.map((call) => [call.params.url, call.params.pageUrl])
      ).toEqual([[`${CDN}/one.jpg`, finalUrl]]);
      expect(saved()?.linkPreview.media).toEqual([
        expect.objectContaining({
          contentType: "image/jpeg",
          storageKey: stores[0]?.params.destinationKey,
          type: "image",
        }),
      ]);
      expect(saved()?.linkPreview).not.toHaveProperty("imageStorageKey");
    });
  });

  describe("social posts", () => {
    const MASTODON_URL = "https://mastodon.social/@Gargron/109311046116149744";
    const MASTODON_API =
      "https://mastodon.social/api/v1/statuses/109311046116149744";

    test("reads a Mastodon status from its instance through the link fetcher", async () => {
      const { fakes, fetch, network, saved } = setup(
        linkCard(MASTODON_URL),
        {},
        {
          route: (url) =>
            url === MASTODON_API
              ? Response.json(socialFixture("mastodon-status.json"))
              : undefined,
        }
      );

      expect(await fetch()).toEqual({ status: "success" });
      expect(network.requests).toEqual([
        { addresses: [PUBLIC], url: MASTODON_API },
      ]);
      expect(new Set(fakes.opsCalled())).toEqual(
        new Set(["store-remote-asset"])
      );
      expect(saved()?.linkPreview).toMatchObject({
        author: "Eugen Rochko",
        categoryHint: "social_post",
        siteName: "Mastodon",
      });
      expect(saved()?.linkPreview).not.toHaveProperty("platform");
    });

    test("falls through to the page when the post is not public", async () => {
      const { fakes, fetch, network } = setup(
        linkCard(MASTODON_URL),
        { "fetch-link-page": await page(ARTICLE, MASTODON_URL) },
        {
          route: () =>
            Response.json({ error: "Record not found" }, { status: 404 }),
        }
      );
      expect(await fetch()).toEqual({ status: "success" });
      expect(network.requests.map((request) => request.url)).toEqual([
        MASTODON_API,
      ]);
      expect(fakes.opsCalled()).toContain("fetch-link-page");
    });

    test("never asks a social API on a private address", async () => {
      const { fakes, fetch, network } = setup(
        linkCard(MASTODON_URL),
        {},
        { addresses: ["127.0.0.1"] }
      );
      expect(await fetch()).toEqual({
        errorType: "blocked_url",
        status: "failed",
      });
      expect(network.requests).toEqual([]);
      expect(fakes.calls).toEqual([]);
    });

    test("stores a Bluesky post's images through the Files ops", async () => {
      const BLUESKY_URL =
        "https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l";
      const { fakes, fetch, saved } = setup(
        linkCard(BLUESKY_URL),
        {
          "store-remote-asset": {
            data: {
              contentType: "image/jpeg",
              height: 1500,
              stored: true,
              width: 2000,
            },
          },
        },
        {
          route: (url) => {
            if (url.includes("resolveHandle")) {
              return Response.json({ did: "did:plc:z72i7hdynmk6r22z27h6tvur" });
            }
            if (url.includes("getPostThread")) {
              return Response.json(socialFixture("bluesky-images.json"));
            }
          },
        }
      );

      expect(await fetch()).toEqual({ status: "success" });
      expect(fakes.opsCalled()).toEqual(
        new Array(4).fill("store-remote-asset")
      );
      expect(fakes.calls.map((call) => call.params.pageUrl)).toEqual(
        new Array(4).fill(BLUESKY_URL)
      );
      expect(saved()?.linkPreview.media).toHaveLength(4);
      expect(saved()?.linkPreview.categoryHint).toBe("social_post");
    });

    test("reads a Threads post from the page it scraped, with no other request", async () => {
      const threadsUrl = "https://www.threads.net/@zuck/post/C8abc123";
      const { fetch, network, saved } = setup(linkCard(threadsUrl), {
        "fetch-link-page": await page(
          `<html><head>
            <meta property="og:title" content="Mark Zuckerberg (@zuck) on Threads">
            <meta property="og:description" content="A new feed today.">
          </head></html>`,
          threadsUrl
        ),
      });
      expect(await fetch()).toEqual({ status: "success" });
      expect(network.requests).toEqual([]);
      expect(saved()?.linkPreview).toMatchObject({
        author: "Mark Zuckerberg",
        categoryHint: "social_post",
        title: "A new feed today.",
      });
    });
  });

  describe("X", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("reads a status from X's oEmbed before any scrape", async () => {
      const requested: string[] = [];
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = String(input);
        requested.push(new URL(url).host);
        return Promise.resolve(
          url.includes("/oembed")
            ? Response.json({
                author_name: "jack",
                author_url: "https://x.com/jack",
                html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20">March 21, 2006</a></blockquote>',
                url: "https://x.com/jack/status/20",
              })
            : new Response("nope", { status: 404 })
        );
      }) as typeof fetch;
      const { fakes, fetch, saved } = setup(
        linkCard("https://x.com/jack/status/20")
      );

      expect(await fetch()).toEqual({ status: "success" });
      expect(fakes.calls).toEqual([]);
      expect(saved()?.linkPreview.title).toBe("just setting up my twttr");
      expect(
        requested.every((host) =>
          ["publish.x.com", "cdn.syndication.twimg.com"].includes(host)
        )
      ).toBe(true);
    });
  });
});
