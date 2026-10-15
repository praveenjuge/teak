// @ts-nocheck
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

const toUrlString = (input: string | URL | Request) => {
  if (input instanceof Request) {
    return input.url;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input;
};

const mockParseLinkPreview = mock();
const mockBuildSuccessPreview = mock();
const mockBuildErrorPreview = mock();
const mockExtractInstagramMedia = mock();
const mockScrapeElements: { selector: string }[] = [];

mock.module("../../../../../convex/linkMetadata", () => ({
  normalizeUrl: (url) => url,
  parseLinkPreview: mockParseLinkPreview,
  buildSuccessPreview: mockBuildSuccessPreview,
  buildErrorPreview: mockBuildErrorPreview,
  isInstagramPostUrl: (url) => /instagram\.com\/(p|reel)\//.test(url),
  isInstagramUrl: (url) => /instagram\.com/.test(url),
  extractInstagramMediaFromHtml: mockExtractInstagramMedia,
  SCRAPE_ELEMENTS: mockScrapeElements,
}));

// Keep SSRF validation out of this unit test: delegate safeFetch to the mocked
// global fetch and treat every URL as safe. The real outbound URL policy is
// exercised in linkMetadata/ssrf.test.ts.
mock.module("../../../../../convex/linkMetadata/ssrf", () => ({
  SsrfError: class SsrfError extends Error {
    reason: string;
    constructor(reason: string, message?: string) {
      super(message ?? reason);
      this.name = "SsrfError";
      this.reason = reason;
    }
  },
  isBlockedIp: () => false,
  detectIpVersion: () => 0,
  assertUrlStructureSafe: (url: string) => new URL(url),
  assertUrlIsSafe: async (url: string) => new URL(url),
  readBodyWithLimit: async (response: Response, maxBytes: number) => {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error("body_too_large");
    }
    return bytes;
  },
  safeFetch: (url: string, _resolveDns: unknown, init?: RequestInit) =>
    globalThis.fetch(url, init),
}));

import { gzipSync } from "node:zlib";
import {
  r2MockModuleFactory,
  r2Mocks,
} from "../../../helpers/r2Mock.test-utils";

mock.module("../../../../../convex/storage/r2", r2MockModuleFactory);

import { internal } from "../../../../../convex/_generated/api";
import { fetchMetadataHandler } from "../../../../../convex/workflows/steps/linkMetadata/fetchMetadata";

describe("fetchMetadata", () => {
  const mockRunQuery = mock();
  const mockRunMutation = mock();
  const ctx = {
    runQuery: mockRunQuery,
    runMutation: mockRunMutation,
  } as any;

  const originalFetch = global.fetch;
  const mockFetch = mock();

  beforeAll(() => {
    global.fetch = mockFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunMutation.mockReset();
    mockFetch.mockReset();
    mockParseLinkPreview.mockReset();
    mockBuildSuccessPreview.mockReset();
    mockBuildErrorPreview.mockReset();
    mockExtractInstagramMedia.mockReset();
    mockScrapeElements.splice(0);
    r2Mocks.storeObject.mockReset();

    // Standard mock resolutions
    mockParseLinkPreview.mockReturnValue({});
    mockBuildSuccessPreview.mockReturnValue({});
    mockBuildErrorPreview.mockImplementation((url, error) => ({ url, error }));
    mockExtractInstagramMedia.mockReturnValue(undefined);
    r2Mocks.storeObject.mockImplementation(async () => "stored-asset");

    mockFetch.mockImplementation(
      () =>
        new Response("<html><head><title>Example</title></head></html>", {
          headers: { "content-type": "text/html" },
          status: 200,
        })
    );
  });

  test("handles missing card", async () => {
    mockRunQuery.mockResolvedValue(null);
    await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.objectContaining({
        cardId: "c1",
        status: "failed",
        linkPreview: expect.objectContaining({
          error: expect.objectContaining({ type: "invalid_card" }),
        }),
      })
    );
  });

  test("handles card without url", async () => {
    mockRunQuery.mockResolvedValue({ _id: "c1" });
    await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.any(Object)
    );
  });

  test("handles non-link card", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "text",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } },
    });
    await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(mockRunMutation).toHaveBeenCalled();
  });

  test("throws retryable if awaiting classification", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "pending" } },
    });

    await expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /retryable/
    );
  });

  test("successful scrape", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } },
    });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result).toMatchObject({ status: "success" });
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.objectContaining({
        cardId: "c1",
        status: "completed",
      })
    );
  });

  test("reads Instagram post media from the HTML it already fetched", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://www.instagram.com/p/DBY4WfSxA0a/",
      metadata: { linkCategory: { status: "completed" } },
    });
    const html = '<html><script type="application/json">{}</script></html>';
    mockFetch.mockImplementation(
      () =>
        new Response(html, {
          headers: { "content-type": "text/html" },
          status: 200,
        })
    );

    await fetchMetadataHandler(ctx, { cardId: "c1" });

    expect(mockExtractInstagramMedia).toHaveBeenCalledWith(
      "https://www.instagram.com/p/DBY4WfSxA0a/",
      html
    );
    // One page fetch: the parser and the browser reuse the same HTML.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("without a Files Worker, scrapes the static HTML it fetched itself", async () => {
    mockScrapeElements.push({ selector: "head > title" });
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } },
    });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });

    expect(result.status).toBe("success");
    expect(mockParseLinkPreview).toHaveBeenCalledWith("https://example.com", [
      {
        selector: "head > title",
        results: [{ text: "Example" }],
      },
    ]);
  });

  const workerOk = (data: unknown) =>
    Response.json({ ok: true, version: 1, requestId: "r1", data });

  const linkPage = ({
    html = "<html></html>",
    pageUrl = "https://example.com/",
    selectors = [],
    source = "static",
  }: {
    html?: string;
    pageUrl?: string;
    selectors?: unknown[];
    source?: string;
  } = {}) => ({
    charset: "utf-8",
    fetched: true,
    htmlGzipBase64: gzipSync(Buffer.from(html, "utf8")).toString("base64"),
    pageUrl,
    selectors,
    source,
  });

  /** Run with a Files Worker configured; `answer` handles its ops. */
  const withFilesWorker = async (
    answer: (body: { op: string; params: Record<string, any> }) => Response,
    run: (ops: { op: string; params: Record<string, any> }[]) => Promise<void>
  ) => {
    const previous = [process.env.FILES_BASE, process.env.FILES_SIGNING_SECRET];
    process.env.FILES_BASE = "https://files.teakvault.com";
    process.env.FILES_SIGNING_SECRET = "test-signing-secret";
    const ops: { op: string; params: Record<string, any> }[] = [];
    mockFetch.mockImplementation((input: string | URL | Request, init) => {
      const url = toUrlString(input);
      if (url.startsWith("https://files.teakvault.com/__ops/v1")) {
        const body = JSON.parse(String(init?.body));
        ops.push(body);
        return Promise.resolve(answer(body));
      }
      throw new Error(`Convex fetched ${url} itself`);
    });
    try {
      await run(ops);
    } finally {
      [process.env.FILES_BASE, process.env.FILES_SIGNING_SECRET] = previous;
      if (previous[0] === undefined) {
        delete process.env.FILES_BASE;
      }
      if (previous[1] === undefined) {
        delete process.env.FILES_SIGNING_SECRET;
      }
    }
  };

  const linkCard = (url = "https://example.com") => ({
    _id: "c1",
    userId: "u1",
    type: "link",
    url,
    metadata: { linkCategory: { status: "completed" } },
  });

  describe("with a Files Worker", () => {
    test("fetches and scrapes the page there instead of in Convex", async () => {
      mockScrapeElements.push(
        { selector: "head > title" },
        { selector: "meta[property='og:title']" }
      );
      mockRunQuery.mockResolvedValue(linkCard());
      const selectors = [
        { selector: "head > title", results: [{ text: "Rendered" }] },
        { selector: "meta[property='og:title']", results: [] },
      ];

      await withFilesWorker(
        () => workerOk(linkPage({ selectors, source: "browser" })),
        async (ops) => {
          const result = await fetchMetadataHandler(ctx, { cardId: "c1" });

          expect(result.status).toBe("success");
          expect(ops).toEqual([
            {
              op: "fetch-link-page",
              params: {
                selectors: ["head > title", "meta[property='og:title']"],
                url: "https://example.com",
              },
              version: 1,
            },
          ]);
          expect(mockParseLinkPreview).toHaveBeenCalledWith(
            "https://example.com",
            selectors
          );
        }
      );
    });

    test("reads Instagram media from the page it returns, with the final URL as Referer", async () => {
      mockRunQuery.mockResolvedValue(
        linkCard("https://www.instagram.com/p/DBY4WfSxA0a/")
      );
      mockRunMutation.mockResolvedValue(true);
      const html = '<html><script type="application/json">{"é":1}</script>';
      mockExtractInstagramMedia.mockReturnValue([
        {
          type: "image",
          url: "https://cdninstagram.com/media/one.jpg",
          contentType: "image/jpeg",
        },
      ]);

      await withFilesWorker(
        ({ op }) =>
          op === "fetch-link-page"
            ? workerOk(
                linkPage({
                  html,
                  pageUrl: "https://www.instagram.com/p/DBY4WfSxA0a/?hl=en",
                })
              )
            : workerOk({ stored: false, reason: "http_error", status: 404 }),
        async (ops) => {
          await fetchMetadataHandler(ctx, { cardId: "c1" });

          expect(mockExtractInstagramMedia).toHaveBeenCalledWith(
            "https://www.instagram.com/p/DBY4WfSxA0a/",
            html
          );
          // The media item, then the same image again as the preview image.
          expect(
            ops
              .filter(({ op }) => op === "store-remote-asset")
              .map(({ params }) => params.pageUrl)
          ).toEqual(
            new Array(2).fill("https://www.instagram.com/p/DBY4WfSxA0a/?hl=en")
          );
        }
      );
    });

    test.each([
      [404, "http_error"],
      [410, "http_error"],
    ])("stores a failed preview for HTTP %d", async (status, errorType) => {
      mockRunQuery.mockResolvedValue(linkCard());
      await withFilesWorker(
        () => workerOk({ fetched: false, reason: "http_error", status }),
        async () => {
          const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
          expect(result).toMatchObject({
            status: "failed",
            errorType,
            errorMessage: `HTTP ${status}`,
          });
        }
      );
    });

    test("stores a failed preview when a redirect reaches a disallowed destination", async () => {
      mockRunQuery.mockResolvedValue(linkCard());
      await withFilesWorker(
        () => workerOk({ fetched: false, reason: "blocked_url" }),
        async () => {
          const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
          expect(result).toMatchObject({
            status: "failed",
            errorType: "blocked_url",
          });
          expect(mockRunMutation).toHaveBeenCalledWith(
            internal.linkMetadata.updateCardMetadata,
            expect.objectContaining({
              status: "failed",
              linkPreview: expect.objectContaining({
                error: expect.objectContaining({ type: "blocked_url" }),
              }),
            })
          );
        }
      );
    });

    test.each([
      [
        "a 429",
        { fetched: false, reason: "http_error", status: 429 },
        /"type":"rate_limit"/,
      ],
      [
        "a 503",
        { fetched: false, reason: "http_error", status: 503 },
        /"type":"scrape_error".*HTTP 503/,
      ],
      [
        "a non-HTML page",
        {
          fetched: false,
          reason: "unsupported_type",
          contentType: "application/pdf",
        },
        /unsupported_type: application\/pdf/,
      ],
      [
        "a page over 2 MiB",
        { fetched: false, reason: "too_large" },
        /too_large/,
      ],
      [
        "a failed connection",
        { fetched: false, reason: "fetch_failed" },
        /fetch_failed/,
      ],
    ])(
      "retries %s, as when Convex fetched it",
      async (_label, data, message) => {
        mockRunQuery.mockResolvedValue(linkCard());
        await withFilesWorker(
          () => workerOk(data),
          async () => {
            await expect(
              fetchMetadataHandler(ctx, { cardId: "c1" })
            ).rejects.toThrow(message);
            expect(mockRunMutation).not.toHaveBeenCalled();
          }
        );
      }
    );

    test.each([
      [
        "busy",
        () =>
          Response.json(
            {
              ok: false,
              version: 1,
              error: {
                code: "RENDERER_UNAVAILABLE",
                message: "all_fetchers_busy",
                requestId: "r1",
                retryable: true,
              },
            },
            { status: 503 }
          ),
      ],
      [
        "unreachable",
        () => {
          throw new TypeError("connect ECONNREFUSED");
        },
      ],
      [
        "missing the op",
        () =>
          Response.json(
            {
              ok: false,
              version: 1,
              error: {
                code: "UNSUPPORTED",
                message: "unknown_op",
                requestId: "r1",
                retryable: false,
              },
            },
            { status: 415 }
          ),
      ],
    ])("retries the step when the Worker is %s", async (_label, answer) => {
      mockRunQuery.mockResolvedValue(linkCard());
      await withFilesWorker(answer, async () => {
        await expect(
          fetchMetadataHandler(ctx, { cardId: "c1" })
        ).rejects.toThrow(/"type":"scrape_error".*Link page fetch unavailable/);
        expect(mockRunMutation).not.toHaveBeenCalled();
      });
    });
  });

  // Remote assets download on the Files Worker's link fetcher, which stores
  // them in R2; Convex only names the URL and the destination key.
  const withAssetWorker = async (
    pageHtml: string,
    stored: Record<string, Record<string, unknown>>,
    run: (ops: Record<string, any>[]) => Promise<void>
  ) => {
    const previous = [process.env.FILES_BASE, process.env.FILES_SIGNING_SECRET];
    process.env.FILES_BASE = "https://files.teakvault.com";
    process.env.FILES_SIGNING_SECRET = "test-signing-secret";
    // registerObject accepts every key.
    mockRunMutation.mockResolvedValue(true);
    const ops: Record<string, any>[] = [];
    mockFetch.mockImplementation((input: string | URL | Request, init) => {
      const url = toUrlString(input);
      if (url.startsWith("https://files.teakvault.com/__ops/v1")) {
        const body = JSON.parse(String(init?.body));
        if (body.op === "fetch-link-page") {
          return Promise.resolve(
            workerOk(linkPage({ html: pageHtml, pageUrl: body.params.url }))
          );
        }
        ops.push(body);
        return Promise.resolve(
          workerOk(
            stored[body.params.url] ?? {
              stored: false,
              reason: "http_error",
              status: 404,
            }
          )
        );
      }
      throw new Error(`Convex fetched ${url} itself`);
    });
    try {
      await run(ops);
    } finally {
      [process.env.FILES_BASE, process.env.FILES_SIGNING_SECRET] = previous;
      if (previous[0] === undefined) {
        delete process.env.FILES_BASE;
      }
      if (previous[1] === undefined) {
        delete process.env.FILES_SIGNING_SECRET;
      }
    }
  };

  test("stores instagram post media through the Files Worker's link fetcher", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      userId: "u1",
      type: "link",
      url: "https://www.instagram.com/p/DBY4WfSxA0a/",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockParseLinkPreview.mockReturnValue({ title: "Instagram post" });
    mockExtractInstagramMedia.mockReturnValue([
      {
        type: "image",
        url: "https://cdninstagram.com/media/one.jpg",
        contentType: "image/jpeg",
        width: 1080,
        height: 1350,
      },
      {
        type: "video",
        url: "https://cdninstagram.com/media/two.mp4",
        contentType: "video/mp4",
        width: 720,
        height: 1280,
        posterUrl: "https://cdninstagram.com/media/two.jpg",
        posterContentType: "image/jpeg",
      },
    ]);

    await withAssetWorker(
      "<html></html>",
      {
        "https://cdninstagram.com/media/one.jpg": {
          stored: true,
          contentType: "image/jpeg",
          size: 10,
          width: 1080,
          height: 1350,
        },
        "https://cdninstagram.com/media/two.mp4": {
          stored: true,
          contentType: "video/mp4",
          size: 20,
        },
        "https://cdninstagram.com/media/two.jpg": {
          stored: true,
          contentType: "image/jpeg",
          size: 5,
          width: 640,
          height: 1138,
        },
      },
      async (ops) => {
        const result = await fetchMetadataHandler(ctx, { cardId: "c1" });

        expect(result.status).toBe("success");
        // Media items are stored concurrently, so compare by URL.
        expect(
          ops
            .map(({ op, params }) => [op, params.kind, params.url])
            .sort((left, right) => left[2].localeCompare(right[2]))
        ).toEqual([
          [
            "store-remote-asset",
            "image",
            "https://cdninstagram.com/media/one.jpg",
          ],
          [
            "store-remote-asset",
            "image",
            "https://cdninstagram.com/media/two.jpg",
          ],
          [
            "store-remote-asset",
            "video",
            "https://cdninstagram.com/media/two.mp4",
          ],
        ]);
        // The page goes along so the fetcher can send it as the Referer.
        expect(ops.map(({ params }) => params.pageUrl)).toEqual(
          new Array(3).fill("https://www.instagram.com/p/DBY4WfSxA0a/")
        );
        const keyFor = (url: string) =>
          ops.find(({ params }) => params.url === url)?.params.destinationKey;
        expect(r2Mocks.storeObject).not.toHaveBeenCalled();
        expect(mockBuildSuccessPreview).toHaveBeenCalledWith(
          "https://www.instagram.com/p/DBY4WfSxA0a/",
          expect.objectContaining({
            title: "Instagram post",
            media: [
              expect.objectContaining({
                type: "image",
                storageKey: keyFor("https://cdninstagram.com/media/one.jpg"),
                contentType: "image/jpeg",
              }),
              expect.objectContaining({
                type: "video",
                storageKey: keyFor("https://cdninstagram.com/media/two.mp4"),
                posterStorageKey: keyFor(
                  "https://cdninstagram.com/media/two.jpg"
                ),
                posterWidth: 640,
                posterHeight: 1138,
              }),
            ],
          })
        );
      }
    );
  });

  test("falls back to preview-only metadata for instagram posts without downloadable media", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://www.instagram.com/reel/Cr9Lx2xJ0Ab/",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockParseLinkPreview.mockReturnValue({
      title: "Instagram reel",
      imageUrl: "https://cdninstagram.com/media/poster.jpg",
    });
    mockFetch
      .mockResolvedValueOnce(
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
          status: 200,
        })
      )
      .mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (header: string) =>
            header === "content-type" ? "image/jpeg" : null,
        },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });

    expect(result.status).toBe("success");
    expect(mockBuildSuccessPreview).toHaveBeenCalledWith(
      "https://www.instagram.com/reel/Cr9Lx2xJ0Ab/",
      expect.objectContaining({
        title: "Instagram reel",
      })
    );
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.objectContaining({
        status: "completed",
      })
    );
  });

  test("stores a preview image when instagram media cannot be persisted", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      userId: "u1",
      type: "link",
      url: "https://www.instagram.com/reel/Cr9Lx2xJ0Ab/",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockParseLinkPreview.mockReturnValue({
      title: "Instagram reel",
      imageUrl: "https://cdninstagram.com/media/poster.png",
    });
    mockExtractInstagramMedia.mockReturnValue([
      {
        type: "video",
        url: "https://cdninstagram.com/media/reel.mp4",
        contentType: "video/mp4",
        posterUrl: "https://cdninstagram.com/media/poster.png",
        posterContentType: "image/png",
      },
    ]);

    await withAssetWorker(
      "<html></html>",
      {
        "https://cdninstagram.com/media/reel.mp4": {
          stored: false,
          reason: "http_error",
          status: 403,
        },
        "https://cdninstagram.com/media/poster.png": {
          stored: true,
          contentType: "image/png",
          size: 67,
          width: 1,
          height: 1,
        },
      },
      async (ops) => {
        const result = await fetchMetadataHandler(ctx, { cardId: "c1" });

        expect(result.status).toBe("success");
        expect(ops.map(({ params }) => [params.kind, params.url])).toEqual([
          ["video", "https://cdninstagram.com/media/reel.mp4"],
          ["image", "https://cdninstagram.com/media/poster.png"],
        ]);
        expect(mockBuildSuccessPreview).toHaveBeenCalledWith(
          "https://www.instagram.com/reel/Cr9Lx2xJ0Ab/",
          expect.objectContaining({
            title: "Instagram reel",
            imageUrl: "https://cdninstagram.com/media/poster.png",
            imageStorageKey: ops[1]?.params.destinationKey,
            imageWidth: 1,
            imageHeight: 1,
          })
        );
      }
    );
  });

  test("keeps the preview without its image when the fetcher skips it", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      userId: "u1",
      type: "link",
      url: "https://www.instagram.com/p/DBY4WfSxA0a/",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockParseLinkPreview.mockReturnValue({
      title: "Post",
      imageUrl: "https://cdninstagram.com/media/huge.jpg",
    });

    await withAssetWorker(
      "<html></html>",
      {
        "https://cdninstagram.com/media/huge.jpg": {
          stored: false,
          reason: "too_large",
        },
      },
      async () => {
        const result = await fetchMetadataHandler(ctx, { cardId: "c1" });

        expect(result.status).toBe("success");
        const preview = mockBuildSuccessPreview.mock.calls[0]?.[1];
        expect(preview).toMatchObject({ title: "Post" });
        expect(preview).not.toHaveProperty("imageStorageKey");
      }
    );
  });

  test("uses X oEmbed metadata for status URLs before scraping", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://x.com/jack/status/20",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        author_name: "jack",
        author_url: "https://x.com/jack",
        html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20">March 21, 2006</a></blockquote>`,
        url: "https://x.com/jack/status/20",
      }),
    });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });

    expect(result.status).toBe("success");
    expect(mockParseLinkPreview).not.toHaveBeenCalled();
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.objectContaining({
        cardId: "c1",
        status: "completed",
      })
    );
  });

  test("retries a page whose server fails as a scrape error", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: { get: () => "text/html" },
      })
      .mockResolvedValue(
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
          status: 200,
        })
      );

    await expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /"type":"scrape_error"/
    );
  });

  test("handles rate limit failure (retryable)", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => "text/html" },
    });

    await expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /"type":"rate_limit"/
    );
    expect(mockRunMutation).not.toHaveBeenCalled();
  });

  test.each([400, 401, 403, 404, 410])(
    "stores a failed preview without retrying or opening a browser for HTTP %d",
    async (status) => {
      mockRunQuery.mockResolvedValue({
        _id: "c1",
        type: "link",
        url: "https://example.com/gone",
        metadata: { linkCategory: { status: "completed" } },
      });
      mockFetch.mockResolvedValue({
        ok: false,
        status,
        headers: { get: () => "text/html" },
      });

      const result = await fetchMetadataHandler(ctx, { cardId: "c1" });

      expect(result).toMatchObject({
        status: "failed",
        errorType: "http_error",
        errorMessage: `HTTP ${status}`,
      });
      expect(mockRunMutation).toHaveBeenCalledWith(
        internal.linkMetadata.updateCardMetadata,
        expect.objectContaining({
          status: "failed",
          linkPreview: expect.objectContaining({
            error: expect.objectContaining({ type: "http_error" }),
          }),
        })
      );
    }
  );

  test.each([408, 500, 503])("keeps HTTP %d retryable", async (status) => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      metadata: { linkCategory: { status: "completed" } },
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status,
      headers: { get: () => "text/html" },
    });

    await expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /retryable/
    );
    expect(mockRunMutation).not.toHaveBeenCalled();
  });

  test("throws retryable if non-link card is still being classified", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "text", // not a link
      url: "https://example.com",
      processingStatus: { classify: { status: "pending" } },
    });

    await expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /awaiting_classification/
    );
  });

  test("handles AbortError (timeout)", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } },
    });

    // Make parsing throw AbortError
    const abortError = new Error("Abort");
    abortError.name = "AbortError";
    mockParseLinkPreview.mockImplementation(() => {
      throw abortError;
    });

    await expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /timeout/
    );
  });

  test("handles TypeError (network)", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } },
    });

    // Make parsing throw TypeError with fetch
    const typeError = new TypeError("Failed to fetch");
    mockParseLinkPreview.mockImplementation(() => {
      throw typeError;
    });

    await expect(fetchMetadataHandler(ctx, { cardId: "c1" })).rejects.toThrow(
      /network_error/
    );
  });

  test("handles non-retryable error during metadata extraction", async () => {
    mockRunQuery.mockResolvedValue({
      _id: "c1",
      type: "link",
      url: "https://example.com",
      processingStatus: { classify: { status: "completed" } },
    });

    mockParseLinkPreview.mockImplementation(() => {
      throw new Error("Fatal error");
    });
    mockBuildErrorPreview.mockReturnValue({ error: "built error" });

    const result = await fetchMetadataHandler(ctx, { cardId: "c1" });
    expect(result.status).toBe("failed");
    expect(mockRunMutation).toHaveBeenCalledWith(
      internal.linkMetadata.updateCardMetadata,
      expect.objectContaining({
        status: "failed",
      })
    );
  });
});
