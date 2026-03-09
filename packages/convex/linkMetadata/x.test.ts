import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  extractXStatusId,
  fetchXStatusMetadata,
  isXHostname,
  isXStatusUrl,
  isXUrl,
} from "./x";

type MockFetchInput = string | URL | Request;

const getRequestUrl = (input: MockFetchInput): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }

  return input instanceof URL ? input : new URL(input);
};

const isRequestUrl = (
  input: MockFetchInput,
  {
    hostname,
    pathname,
  }: {
    hostname: string;
    pathname: string;
  }
): boolean => {
  const url = getRequestUrl(input);
  return url.hostname === hostname && url.pathname === pathname;
};

const createJsonResponse = <TPayload>(payload: TPayload) => ({
  ok: true,
  json: async () => payload,
});

describe("x link metadata", () => {
  const originalFetch = global.fetch;
  const mockFetch = mock();

  beforeAll(() => {
    global.fetch = mockFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("isXHostname", () => {
    test("matches x.com and twitter.com hosts", () => {
      expect(isXHostname("x.com")).toBe(true);
      expect(isXHostname("www.x.com")).toBe(true);
      expect(isXHostname("twitter.com")).toBe(true);
      expect(isXHostname("mobile.twitter.com")).toBe(true);
    });

    test("rejects unrelated hosts", () => {
      expect(isXHostname("example.com")).toBe(false);
      expect(isXHostname("x.com.example.com")).toBe(false);
      expect(isXHostname("nottwitter.com")).toBe(false);
    });
  });

  describe("isXUrl", () => {
    test("accepts X and Twitter URLs", () => {
      expect(isXUrl("https://x.com/teak/status/123")).toBe(true);
      expect(isXUrl("https://twitter.com/teak/status/123")).toBe(true);
    });

    test("rejects invalid URLs", () => {
      expect(isXUrl("x.com/teak/status/123")).toBe(false);
      expect(isXUrl("not-a-url")).toBe(false);
    });
  });

  describe("extractXStatusId", () => {
    test("extracts tweet ids from supported paths", () => {
      expect(extractXStatusId("https://x.com/teak/status/123")).toBe("123");
      expect(extractXStatusId("https://twitter.com/i/web/status/456")).toBe(
        "456"
      );
      expect(extractXStatusId("https://x.com/i/status/789?ref=home")).toBe(
        "789"
      );
    });

    test("returns undefined for non-status URLs", () => {
      expect(extractXStatusId("https://x.com/teak")).toBeUndefined();
      expect(
        extractXStatusId("https://example.com/status/123")
      ).toBeUndefined();
    });
  });

  describe("isXStatusUrl", () => {
    test("detects public status URLs", () => {
      expect(isXStatusUrl("https://x.com/teak/status/123")).toBe(true);
      expect(isXStatusUrl("https://twitter.com/i/web/status/456")).toBe(true);
    });

    test("ignores non-status URLs", () => {
      expect(isXStatusUrl("https://x.com/teak")).toBe(false);
    });
  });

  describe("fetchXStatusMetadata", () => {
    test("maps oEmbed data into link preview metadata", async () => {
      mockFetch.mockImplementation(async (input: MockFetchInput) => {
        if (
          isRequestUrl(input, {
            hostname: "publish.x.com",
            pathname: "/oembed",
          })
        ) {
          return createJsonResponse({
            author_name: "jack",
            author_url: "https://x.com/jack",
            html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20">March 21, 2006</a></blockquote>`,
            url: "https://x.com/jack/status/20",
          });
        }

        if (
          isRequestUrl(input, {
            hostname: "cdn.syndication.twimg.com",
            pathname: "/tweet-result",
          })
        ) {
          return createJsonResponse({
            id_str: "20",
            text: "just setting up my twttr",
            user: { name: "jack", screen_name: "jack" },
          });
        }

        throw new Error(`Unexpected fetch URL: ${getRequestUrl(input).href}`);
      });

      const result = await fetchXStatusMetadata("https://x.com/jack/status/20");

      expect(result?.title).toBe("just setting up my twttr");
      expect(result?.description).toBe("@jack on X · March 21, 2006");
      expect(result?.author).toBe("jack");
      expect(result?.siteName).toBe("X");
      expect(result?.publisher).toBe("X");
      expect(result?.publishedAt).toBe("March 21, 2006");
      expect(result?.canonicalUrl).toBe("https://x.com/jack/status/20");
      expect(result?.finalUrl).toBe("https://x.com/jack/status/20");
    });

    test("falls back to publish.twitter.com when publish.x.com is empty", async () => {
      mockFetch.mockImplementation(async (input: MockFetchInput) => {
        if (
          isRequestUrl(input, {
            hostname: "publish.x.com",
            pathname: "/oembed",
          })
        ) {
          return createJsonResponse({});
        }

        if (
          isRequestUrl(input, {
            hostname: "publish.twitter.com",
            pathname: "/oembed",
          })
        ) {
          return createJsonResponse({
            author_name: "Teak",
            author_url: "https://twitter.com/teak",
            html: `<blockquote class="twitter-tweet"><p>Collect ideas faster</p>&mdash; Teak (@teak) <a href="https://twitter.com/teak/status/123">March 8, 2026</a></blockquote>`,
            url: "https://twitter.com/teak/status/123",
          });
        }

        if (
          isRequestUrl(input, {
            hostname: "cdn.syndication.twimg.com",
            pathname: "/tweet-result",
          })
        ) {
          return createJsonResponse({
            id_str: "123",
            text: "Collect ideas faster",
            user: { name: "Teak", screen_name: "teak" },
          });
        }

        throw new Error(`Unexpected fetch URL: ${getRequestUrl(input).href}`);
      });

      const result = await fetchXStatusMetadata(
        "https://x.com/teak/status/123"
      );

      expect(result?.title).toBe("Collect ideas faster");
      expect(result?.description).toBe("Teak (@teak) on X · March 8, 2026");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    test("extracts attached media from X syndication payload", async () => {
      mockFetch.mockImplementation(async (input: MockFetchInput) => {
        if (
          isRequestUrl(input, {
            hostname: "publish.x.com",
            pathname: "/oembed",
          })
        ) {
          return createJsonResponse({
            author_name: "Teak",
            author_url: "https://x.com/teak",
            html: `<blockquote class="twitter-tweet"><p>Collect ideas faster</p>&mdash; Teak (@teak) <a href="https://x.com/teak/status/123">March 8, 2026</a></blockquote>`,
            url: "https://x.com/teak/status/123",
          });
        }

        if (
          isRequestUrl(input, {
            hostname: "cdn.syndication.twimg.com",
            pathname: "/tweet-result",
          })
        ) {
          return createJsonResponse({
            id_str: "123",
            mediaDetails: [
              {
                type: "photo",
                media_url_https: "https://pbs.twimg.com/media/one.jpg",
                original_info: { width: 1200, height: 900 },
              },
              {
                type: "video",
                media_url_https: "https://pbs.twimg.com/media/poster.jpg",
                original_info: { width: 1280, height: 720 },
                video_info: {
                  variants: [
                    {
                      content_type: "video/mp4",
                      bitrate: 832_000,
                      url: "https://video.twimg.com/vid/640x360/video.mp4",
                    },
                    {
                      content_type: "video/mp4",
                      bitrate: 2_176_000,
                      url: "https://video.twimg.com/vid/1280x720/video.mp4",
                    },
                  ],
                },
              },
            ],
            user: { name: "Teak", screen_name: "teak" },
          });
        }

        throw new Error(`Unexpected fetch URL: ${getRequestUrl(input).href}`);
      });

      const result = await fetchXStatusMetadata(
        "https://x.com/teak/status/123"
      );

      expect(result?.media).toEqual([
        {
          type: "image",
          url: "https://pbs.twimg.com/media/one.jpg",
          contentType: "image/jpeg",
          width: 1200,
          height: 900,
        },
        {
          type: "video",
          url: "https://video.twimg.com/vid/1280x720/video.mp4",
          contentType: "video/mp4",
          width: 1280,
          height: 720,
          posterUrl: "https://pbs.twimg.com/media/poster.jpg",
          posterContentType: "image/jpeg",
          posterWidth: 1280,
          posterHeight: 720,
        },
      ]);
    });

    test("returns null for non-status URLs", async () => {
      await expect(
        fetchXStatusMetadata("https://x.com/teak")
      ).resolves.toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
