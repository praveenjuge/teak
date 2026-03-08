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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          author_name: "jack",
          author_url: "https://x.com/jack",
          html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20">March 21, 2006</a></blockquote>`,
          url: "https://x.com/jack/status/20",
        }),
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
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            author_name: "Teak",
            author_url: "https://twitter.com/teak",
            html: `<blockquote class="twitter-tweet"><p>Collect ideas faster</p>&mdash; Teak (@teak) <a href="https://twitter.com/teak/status/123">March 8, 2026</a></blockquote>`,
            url: "https://twitter.com/teak/status/123",
          }),
        });

      const result = await fetchXStatusMetadata(
        "https://x.com/teak/status/123"
      );

      expect(result?.title).toBe("Collect ideas faster");
      expect(result?.description).toBe("Teak (@teak) on X · March 8, 2026");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("returns null for non-status URLs", async () => {
      await expect(
        fetchXStatusMetadata("https://x.com/teak")
      ).resolves.toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
